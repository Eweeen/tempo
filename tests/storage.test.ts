import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import type { AppData, CalendarEvent } from '../src/types';
import {
  deleteAttachments, exportBackup, getAttachments, importBackup, loadData,
  saveAttachments, saveData,
} from '../src/lib/storage';

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'shift-1', uid: 'shift-1@tempo.local', title: 'Équipe du matin',
    start: '2026-11-09T05:00', end: '2026-11-09T13:00', allDay: false,
    categoryId: 'work', icon: '💼', location: 'Atelier', notes: '', url: '',
    availability: 'busy', alerts: [15], recurrence: { frequency: 'none', interval: 1 },
    timezone: 'Europe/Paris', attachmentIds: [],
    createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z', ...overrides,
  };
}

async function existingDataWithFile(): Promise<AppData> {
  const data = await loadData();
  const files = await saveAttachments('shift-1', [new File(['Mon billet 🎫'], 'billet.txt', { type: 'text/plain' })]);
  data.events = [event({ attachmentIds: files.map((file) => file.id) })];
  await saveData(data);
  return data;
}

const backupFile = (value: unknown) => new File([JSON.stringify(value)], 'sauvegarde.json', { type: 'application/json' });

async function rawWrite(stores: string[], write: (transaction: IDBTransaction) => void): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('tempo-calendar', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(stores, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      write(tx);
    });
  } finally { db.close(); }
}

async function newTab() {
  vi.resetModules();
  return import('../src/lib/storage');
}

describe('stockage local et sauvegardes', () => {
  beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('démarre sans événements fictifs et avec des catégories indépendantes', async () => {
    const data = await loadData();
    expect(data.events).toEqual([]);
    expect(data.settings.timezone).toBe('Europe/Paris');
    data.categories[0].name = 'Modifié';
    expect((await loadData()).categories[0].name).toBe('Travail');
  });

  it('retrouve les événements et les octets des documents après une nouvelle lecture', async () => {
    const data = await existingDataWithFile();
    expect(await loadData()).toEqual(data);
    const attachments = await getAttachments('shift-1');
    expect(attachments).toHaveLength(1);
    expect(attachments[0].name).toBe('billet.txt');
    expect(await attachments[0].blob.text()).toBe('Mon billet 🎫');
    // Deferred cleanup must never remove a document still referenced by state.
    await deleteAttachments([attachments[0].id]);
    expect(await getAttachments('shift-1')).toHaveLength(1);
    await saveData({ ...data, events: [] });
    await deleteAttachments([attachments[0].id]);
    expect(await getAttachments('shift-1')).toEqual([]);
    expect((await loadData()).events).toHaveLength(0);
  });

  it('exporte puis restaure événements, préférences et contenu exact des documents', async () => {
    const original = await existingDataWithFile();
    const backup = await exportBackup(original);
    const content = JSON.parse(await backup.text());
    expect(content.version).toBe(1);
    expect(content.attachments[0].base64).toBeTruthy();
    const changed = { ...original, events: [event({ id: 'changed', uid: 'changed@tempo.local' })] };
    await saveData(changed);
    await deleteAttachments(original.events[0].attachmentIds);
    expect(await importBackup(new File([backup], 'tempo.json'))).toEqual(original);
    expect(await loadData()).toEqual(original);
    expect(await (await getAttachments('shift-1'))[0].blob.text()).toBe('Mon billet 🎫');
  });

  it.each([
    ['date impossible', (backup: any) => { backup.data.events[0].start = '2026-02-30T05:00'; }],
    ['lien exécutable', (backup: any) => { backup.data.events[0].url = 'javascript:alert(1)'; }],
    ['fuseau inconnu', (backup: any) => { backup.data.events[0].timezone = 'Unknown/Nowhere'; }],
    ['document manquant', (backup: any) => { backup.attachments = []; }],
    ['document incomplet', (backup: any) => { backup.attachments[0].size += 1; }],
    ['document mal encodé', (backup: any) => { backup.attachments[0].base64 = '###'; }],
    ['événement doublonné', (backup: any) => { backup.data.events.push(backup.data.events[0]); }],
    ['intervalle nul', (backup: any) => { backup.data.events[0].recurrence.interval = 0; }],
  ])('refuse %s avant toute modification locale', async (_label, corrupt) => {
    const original = await existingDataWithFile();
    const backup = JSON.parse(await (await exportBackup(original)).text());
    corrupt(backup);
    await expect(importBackup(backupFile(backup))).rejects.toThrow();
    expect(await loadData()).toEqual(original);
    expect(await (await getAttachments('shift-1'))[0].blob.text()).toBe('Mon billet 🎫');
  });

  it('annule aussi la suppression des documents si une écriture de restauration échoue', async () => {
    const original = await existingDataWithFile();
    const replacement = await loadData();
    replacement.events = [event({ id: 'new', uid: 'new@tempo.local' })];
    const backup = backupFile({ format: 'tempo-calendar', version: 1, data: replacement, attachments: [] });
    const originalPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (this.name === 'state') throw new DOMException('Espace insuffisant', 'QuotaExceededError');
      return originalPut.call(this, value, key);
    });
    await expect(importBackup(new File([backup], 'tempo.json'))).rejects.toThrow('Espace insuffisant');
    expect(await loadData()).toEqual(original);
    expect(await (await getAttachments('shift-1'))[0].blob.text()).toBe('Mon billet 🎫');
  });

  it('refuse de produire une sauvegarde silencieusement privée de ses documents', async () => {
    const original = await existingDataWithFile();
    await rawWrite(['attachments'], tx => { tx.objectStore('attachments').delete(original.events[0].attachmentIds[0]); });
    await expect(exportBackup(original)).rejects.toThrow('introuvable');
  });

  it('laisse les données existantes intactes face à un fichier JSON incorrect', async () => {
    const original = await existingDataWithFile();
    await expect(importBackup(new File(['{'], 'broken.json'))).rejects.toThrow('JSON valide');
    expect(await loadData()).toEqual(original);
  });

  it('refuse les écritures d’un autre onglet sans effacer les événements récents', async () => {
    const first = await loadData();
    const other = await newTab();
    const stale = await other.loadData();
    const files = await saveAttachments('shift-1', [new File(['Billet récent'], 'recent.txt')]);
    first.events = [event({ attachmentIds: files.map(file => file.id) })];
    await saveData(first);
    await expect(other.saveData({ ...stale, settings: { ...stale.settings, theme: 'dark' } })).rejects.toMatchObject({ name: 'StorageConflictError' });
    // Retrying does not silently adopt the new revision; the user must reload.
    await expect(other.saveData(stale)).rejects.toThrow('Rechargez Tempo');
    expect(await loadData()).toEqual(first);
    expect(await (await getAttachments('shift-1'))[0].blob.text()).toBe('Billet récent');
    const reloaded = await other.loadData();
    await other.saveData({ ...reloaded, settings: { ...reloaded.settings, theme: 'dark' } });
    expect((await loadData()).events).toEqual(first.events);
  });

  it('sérialise deux sauvegardes concurrentes sans perdre une écriture silencieusement', async () => {
    const data = await loadData();
    const writes = await Promise.allSettled([
      saveData({ ...data, events: [event()] }),
      saveData({ ...data, settings: { ...data.settings, theme: 'dark' } }),
    ]);
    expect(writes.filter(write => write.status === 'fulfilled')).toHaveLength(1);
    const rejected = writes.find(write => write.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason.name).toBe('StorageConflictError');
  });

  it('migre un calendrier existant sans révision et protège ensuite ses données', async () => {
    const legacy = await loadData();
    legacy.events = [event()];
    await rawWrite(['state'], tx => { tx.objectStore('state').put(legacy, 'app-data'); });
    const loaded = await loadData();
    const other = await newTab();
    const stale = await other.loadData();
    expect(loaded).toEqual(legacy);
    await saveData({ ...loaded, settings: { ...loaded.settings, theme: 'dark' } });
    await expect(other.saveData({ ...stale, events: [] })).rejects.toMatchObject({ name: 'StorageConflictError' });
    expect((await loadData()).events).toEqual(legacy.events);
  });

  it('refuse une sauvegarde exportée depuis un ancien onglet', async () => {
    const original = await existingDataWithFile();
    const other = await newTab();
    const stale = await other.loadData();
    await saveData({ ...original, events: [...original.events, event({ id: 'new', uid: 'new@tempo.local' })] });
    await expect(other.exportBackup(stale)).rejects.toThrow('autre onglet');
  });

  it('refuse aussi un ancien objet après actualisation locale de la révision', async () => {
    const original = await existingDataWithFile();
    await saveData({ ...original, events: [] });
    await expect(exportBackup(original)).rejects.toMatchObject({ name: 'StorageConflictError' });
  });

  it('exporte un instantané cohérent même si les fichiers sont supprimés pendant leur encodage', async () => {
    const original = await existingDataWithFile();
    const other = await newTab();
    const otherData = await other.loadData();
    const originalArrayBuffer = Blob.prototype.arrayBuffer;
    vi.spyOn(Blob.prototype, 'arrayBuffer').mockImplementationOnce(async function (this: Blob) {
      await other.saveData({ ...otherData, events: [] });
      await other.deleteAttachments(original.events[0].attachmentIds);
      return originalArrayBuffer.call(this);
    });
    const backup = JSON.parse(await (await exportBackup(original)).text());
    expect(backup.data).toEqual(original);
    expect(backup.attachments).toHaveLength(1);
    expect(atob(backup.attachments[0].base64)).toBe(new TextEncoder().encode('Mon billet 🎫').reduce((text, byte) => text + String.fromCharCode(byte), ''));
    expect(await other.getAttachments('shift-1')).toEqual([]);
  });

  it('refuse une restauration périmée avant toute suppression de documents', async () => {
    const original = await existingDataWithFile();
    const other = await newTab();
    const stale = await other.loadData();
    const emptyBackup = backupFile({ format: 'tempo-calendar', version: 1, data: { ...stale, events: [] }, attachments: [] });
    await saveData({ ...original, settings: { ...original.settings, theme: 'dark' } });
    await expect(other.importBackup(emptyBackup)).rejects.toMatchObject({ name: 'StorageConflictError' });
    expect((await loadData()).events).toEqual(original.events);
    expect(await (await getAttachments('shift-1'))[0].blob.text()).toBe('Mon billet 🎫');
  });

  it('détecte une modification arrivée pendant la lecture du fichier à restaurer', async () => {
    const original = await existingDataWithFile();
    const backup = await exportBackup(original);
    const file = new File([backup], 'restore.json');
    const content = await file.text();
    let release!: (value: string) => void;
    vi.spyOn(file, 'text').mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const other = await newTab();
    const otherData = await other.loadData();
    const restoring = importBackup(file);
    const rejected = expect(restoring).rejects.toMatchObject({ name: 'StorageConflictError' });
    await other.saveData({ ...otherData, events: [] });
    release(content);
    await rejected;
    expect((await loadData()).events).toEqual([]);
  });

  it('ne nettoie pas un document réintroduit par une restauration concurrente', async () => {
    const original = await existingDataWithFile();
    const backup = await exportBackup(original);
    await saveData({ ...original, events: [] });
    const other = await newTab();
    await other.loadData();
    await other.importBackup(new File([backup], 'restore.json'));
    await deleteAttachments(original.events[0].attachmentIds);
    expect(await (await getAttachments('shift-1'))[0].blob.text()).toBe('Mon billet 🎫');
    expect((await loadData()).events).toEqual(original.events);
  });
});
