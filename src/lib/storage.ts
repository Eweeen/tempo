import type {
  AppData,
  Attachment,
  CalendarEvent,
  Category,
  Settings,
} from "../types";

const DB_NAME = "tempo-calendar";
const DB_VERSION = 1;
const STATE_KEY = "app-data";
const REVISION_KEY = "app-revision";
// Each browser tab keeps the revision that backs its current view. A UUID also
// avoids accepting a stale tab after a database reset or backup restoration.
let knownRevision: string | null | undefined;
export const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024;
const MAX_BACKUP_SIZE = 250 * 1024 * 1024;

export class StorageConflictError extends Error {
  constructor() {
    super(
      "Le calendrier a été modifié dans un autre onglet. L’opération a été annulée pour préserver vos données. Rechargez Tempo avant de réessayer.",
    );
    this.name = "StorageConflictError";
  }
}

function currentRevision(): string | null {
  if (knownRevision === undefined)
    throw new Error(
      "Chargez le calendrier avant de modifier ou sauvegarder ses données.",
    );
  return knownRevision;
}

function readRevision(value: unknown): string | null {
  if (value === undefined) return null; // Existing databases migrate on first write.
  if (typeof value !== "string" || !value)
    throw new Error("La révision du stockage local est invalide.");
  return value;
}

export const DEFAULT_CATEGORIES: Category[] = [
  { id: "work", name: "Travail", icon: "💼", color: "#5e6ad2" },
  { id: "personal", name: "Personnel", icon: "✨", color: "#f49e4c" },
  { id: "payment", name: "Paiement", icon: "💳", color: "#34a853" },
  { id: "bill", name: "Facture", icon: "🧾", color: "#e06b57" },
  { id: "concert", name: "Concert", icon: "🎵", color: "#b36ad5" },
  { id: "festival", name: "Festival", icon: "🎪", color: "#d96f9e" },
  { id: "birthday", name: "Anniversaire", icon: "🎂", color: "#e3aa31" },
  { id: "sport", name: "Sport", icon: "🏃", color: "#35a8a0" },
];

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  region: "fr",
  showHolidays: true,
  defaultAlert: 15,
  timezone: "Europe/Paris",
};

function initialData(): AppData {
  return {
    events: [],
    categories: structuredClone(DEFAULT_CATEGORIES),
    settings: { ...DEFAULT_SETTINGS },
  };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(
        new Error("Le stockage local est indisponible dans ce navigateur."),
      );
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("state")) db.createObjectStore("state");
      if (!db.objectStoreNames.contains("attachments")) {
        const attachments = db.createObjectStore("attachments", {
          keyPath: "id",
        });
        attachments.createIndex("eventId", "eventId", { unique: false });
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () =>
      reject(
        request.error ?? new Error("Impossible d’ouvrir le stockage local."),
      );
    request.onblocked = () =>
      reject(
        new Error(
          "Fermez les autres onglets de l’application, puis réessayez.",
        ),
      );
  });
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Lecture locale impossible."));
  });
}

function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(
        transaction.error ?? new Error("L’enregistrement local a été annulé."),
      );
  });
}

async function writeTransaction(
  db: IDBDatabase,
  stores: string | string[],
  write: (transaction: IDBTransaction) => void,
): Promise<void> {
  const tx = db.transaction(stores, "readwrite");
  const done = completed(tx);
  try {
    write(tx);
  } catch (error) {
    tx.abort();
    await done.catch(() => undefined);
    throw error;
  }
  await done;
}

/** Read-check-write runs in one IndexedDB transaction, serialized across tabs. */
async function compareAndWrite(
  db: IDBDatabase,
  stores: string | string[],
  expected: string | null,
  write: (transaction: IDBTransaction) => void,
): Promise<void> {
  const revision = crypto.randomUUID();
  const tx = db.transaction(stores, "readwrite");
  const done = completed(tx);
  let failure: unknown;
  const request = tx.objectStore("state").get(REVISION_KEY);
  request.onsuccess = () => {
    try {
      if (readRevision(request.result) !== expected)
        throw new StorageConflictError();
      write(tx);
      tx.objectStore("state").put(revision, REVISION_KEY);
    } catch (error) {
      failure = error;
      tx.abort();
    }
  };
  try {
    await done;
  } catch (error) {
    throw failure ?? error;
  }
  knownRevision = revision;
}

export async function loadData(trackRevision = true): Promise<AppData> {
  const db = await openDatabase();
  try {
    const tx = db.transaction("state", "readonly");
    const done = completed(tx);
    const [stored, revision] = await Promise.all([
      result(tx.objectStore("state").get(STATE_KEY)),
      result(tx.objectStore("state").get(REVISION_KEY)),
      done,
    ]);
    const data = stored === undefined ? initialData() : validateData(stored);
    // Background publication must not acknowledge revisions unseen by the editor.
    if (trackRevision) knownRevision = readRevision(revision);
    return data;
  } finally {
    db.close();
  }
}

export async function saveData(data: AppData): Promise<void> {
  const expected = currentRevision();
  const checked = validateData(data);
  const db = await openDatabase();
  try {
    await compareAndWrite(db, "state", expected, (tx) => {
      tx.objectStore("state").put(checked, STATE_KEY);
    });
  } finally {
    db.close();
  }
}

export async function saveAttachments(
  eventId: string,
  files: File[],
): Promise<Attachment[]> {
  nonempty(eventId, "Identifiant de l’événement", 200);
  const attachments: Attachment[] = files.map((file) => {
    if (!(file instanceof Blob)) throw new Error("Pièce jointe invalide.");
    nonempty(file.name, "Nom du fichier", 255);
    if (file.size > MAX_ATTACHMENT_SIZE)
      throw new Error(
        `« ${file.name} » dépasse la limite de 20 Mo par fichier.`,
      );
    return {
      id: crypto.randomUUID(),
      eventId,
      name: file.name,
      type: file.type,
      size: file.size,
      blob: file,
    };
  });
  if (!attachments.length) return [];
  const db = await openDatabase();
  try {
    await writeTransaction(db, "attachments", (tx) => {
      for (const attachment of attachments)
        tx.objectStore("attachments").add(attachment);
    });
    return attachments;
  } finally {
    db.close();
  }
}

export async function getAttachments(eventId: string): Promise<Attachment[]> {
  const db = await openDatabase();
  try {
    const tx = db.transaction("attachments", "readonly");
    const done = completed(tx);
    const [attachments] = await Promise.all([
      result<Attachment[]>(
        tx.objectStore("attachments").index("eventId").getAll(eventId),
      ),
      done,
    ]);
    return attachments;
  } finally {
    db.close();
  }
}

export async function deleteAttachments(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const db = await openDatabase();
  try {
    const tx = db.transaction(["state", "attachments"], "readwrite");
    const done = completed(tx);
    let failure: unknown;
    const request = tx.objectStore("state").get(STATE_KEY);
    request.onsuccess = () => {
      try {
        const data =
          request.result === undefined
            ? initialData()
            : validateData(request.result);
        const referenced = new Set(
          data.events.flatMap((event) => event.attachmentIds),
        );
        for (const id of ids)
          if (!referenced.has(id)) tx.objectStore("attachments").delete(id);
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
    try {
      await done;
    } catch (error) {
      throw failure ?? error;
    }
  } finally {
    db.close();
  }
}

interface BackupAttachment {
  id: string;
  eventId: string;
  name: string;
  type: string;
  size: number;
  base64: string;
}

interface Backup {
  format: "tempo-calendar";
  version: 1;
  exportedAt: string;
  data: AppData;
  attachments: BackupAttachment[];
}

async function encodeBlob(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(
      String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)),
    );
  }
  return btoa(chunks.join(""));
}

function decodeBlob(encoded: string, type: string): Blob {
  const paddingStart = encoded.indexOf("=");
  const padding = paddingStart === -1 ? "" : encoded.slice(paddingStart);
  if (
    encoded.length > Math.ceil(MAX_ATTACHMENT_SIZE / 3) * 4 ||
    encoded.length % 4 !== 0 ||
    /[^A-Za-z0-9+/=]/.test(encoded) ||
    (padding !== "" && padding !== "=" && padding !== "==")
  ) {
    throw new Error(
      "Le contenu d’une pièce jointe est invalide ou trop volumineux.",
    );
  }
  const decoded = atob(encoded);
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** A portable backup includes the actual document bytes, not only their names. */
export async function exportBackup(data: AppData): Promise<Blob> {
  const expected = currentRevision();
  const checked = validateData(data);
  // Queue every read before awaiting: one coherent snapshot, even if another
  // tab replaces the calendar while document bytes are subsequently encoded.
  const db = await openDatabase();
  let storedFiles: Attachment[];
  try {
    const tx = db.transaction(["state", "attachments"], "readonly");
    const done = completed(tx);
    const fileIds = checked.events.flatMap((event) => event.attachmentIds);
    const [revision, storedData, files] = await Promise.all([
      result(tx.objectStore("state").get(REVISION_KEY)),
      result(tx.objectStore("state").get(STATE_KEY)),
      Promise.all(
        fileIds.map((id) =>
          result<Attachment | undefined>(tx.objectStore("attachments").get(id)),
        ),
      ),
      done,
    ]);
    const stored =
      storedData === undefined ? initialData() : validateData(storedData);
    if (
      readRevision(revision) !== expected ||
      JSON.stringify(stored) !== JSON.stringify(checked)
    )
      throw new StorageConflictError();
    storedFiles = files.filter(
      (file): file is Attachment => file !== undefined,
    );
  } finally {
    db.close();
  }
  const documentsById = new Map(storedFiles.map((item) => [item.id, item]));
  const attachments: BackupAttachment[] = [];
  let rawBytes = 0;
  for (const event of checked.events) {
    for (const id of event.attachmentIds) {
      const item = documentsById.get(id);
      if (!item || item.eventId !== event.id)
        throw new Error(
          `Le document associé à « ${event.title} » est introuvable. La sauvegarde n’a pas été créée.`,
        );
      rawBytes += item.size;
      if ((rawBytes * 4) / 3 > MAX_BACKUP_SIZE - 1024 * 1024)
        throw new Error(
          "La sauvegarde dépasse la limite de 250 Mo. Exportez vos documents séparément.",
        );
      attachments.push({
        id: item.id,
        eventId: item.eventId,
        name: item.name,
        type: item.type,
        size: item.size,
        base64: await encodeBlob(item.blob),
      });
    }
  }
  const backup: Backup = {
    format: "tempo-calendar",
    version: 1,
    exportedAt: new Date().toISOString(),
    data: checked,
    attachments,
  };
  const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
  if (blob.size > MAX_BACKUP_SIZE)
    throw new Error("La sauvegarde dépasse la limite de 250 Mo.");
  return blob;
}

/** Validate and decode everything before opening the single restoring transaction. */
export async function importBackup(file: File): Promise<AppData> {
  const expected = currentRevision();
  if (file.size > MAX_BACKUP_SIZE)
    throw new Error("Le fichier de sauvegarde dépasse la limite de 250 Mo.");
  let value: unknown;
  try {
    value = JSON.parse(await file.text());
  } catch {
    throw new Error("Ce fichier n’est pas une sauvegarde JSON valide.");
  }
  const backup = object(value, "Sauvegarde");
  if (backup.format !== "tempo-calendar" || backup.version !== 1)
    throw new Error("Format ou version de sauvegarde non pris en charge.");
  const data = validateData(backup.data);
  const sourceAttachments = array(backup.attachments, "Documents", 100000);
  const eventMap = new Map(data.events.map((event) => [event.id, event]));
  const seen = new Set<string>();
  const attachments: Attachment[] = sourceAttachments.map((value) => {
    const item = object(value, "Document");
    const id = nonempty(item.id, "Identifiant du document", 200);
    const eventId = nonempty(item.eventId, "Événement du document", 200);
    if (seen.has(id))
      throw new Error("La sauvegarde contient un document en double.");
    seen.add(id);
    if (!eventMap.get(eventId)?.attachmentIds.includes(id))
      throw new Error(
        "Un document est associé à un événement inexistant ou incohérent.",
      );
    const name = nonempty(item.name, "Nom du document", 255);
    const type = string(item.type, "Type du document", 255);
    const size = integer(
      item.size,
      "Taille du document",
      0,
      MAX_ATTACHMENT_SIZE,
    );
    const blob = decodeBlob(
      string(
        item.base64,
        "Contenu du document",
        Math.ceil(MAX_ATTACHMENT_SIZE / 3) * 4,
      ),
      type,
    );
    if (blob.size !== size)
      throw new Error(`Le document « ${name} » est incomplet.`);
    return { id, eventId, name, type, size, blob };
  });
  for (const event of data.events) {
    if (event.attachmentIds.some((id) => !seen.has(id)))
      throw new Error(
        "La sauvegarde contient une référence à un document manquant.",
      );
  }
  const db = await openDatabase();
  try {
    await compareAndWrite(db, ["state", "attachments"], expected, (tx) => {
      tx.objectStore("attachments").clear();
      for (const attachment of attachments)
        tx.objectStore("attachments").put(attachment);
      tx.objectStore("state").put(data, STATE_KEY);
    });
    return data;
  } finally {
    db.close();
  }
}

export async function requestPersistence(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist)
    return false;
  return navigator.storage.persist();
}

export async function storageEstimate(): Promise<{
  usage: number;
  quota: number;
  persistent: boolean;
}> {
  if (typeof navigator === "undefined" || !navigator.storage)
    return { usage: 0, quota: 0, persistent: false };
  const [estimate, persistent] = await Promise.all([
    navigator.storage.estimate?.() ?? Promise.resolve({ usage: 0, quota: 0 }),
    navigator.storage.persisted?.() ?? Promise.resolve(false),
  ]);
  return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0, persistent };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} invalide.`);
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    throw new Error(`${label} invalide ou trop volumineux.`);
  return value;
}

function string(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || value.length > max || value.includes("\0"))
    throw new Error(`${label} invalide.`);
  return value;
}

function nonempty(value: unknown, label: string, max: number): string {
  const text = string(value, label, max);
  if (!text.trim()) throw new Error(`${label} ne peut pas être vide.`);
  return text;
}

function integer(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    throw new Error(`${label} invalide.`);
  return value;
}

function choice<T extends string>(
  value: unknown,
  options: readonly T[],
  label: string,
): T {
  if (typeof value !== "string" || !options.includes(value as T))
    throw new Error(`${label} invalide.`);
  return value as T;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} invalide.`);
  return value;
}

function timezone(value: unknown): string {
  const zone = nonempty(value, "Fuseau horaire", 100);
  if (zone !== "Europe/Paris" && zone !== "UTC")
    throw new Error(
      `Fuseau horaire non pris en charge : ${zone}. Cette version accepte Europe/Paris et UTC.`,
    );
  return zone;
}

function localDate(value: unknown, label: string, withTime = true): string {
  const date = string(value, label, withTime ? 16 : 10);
  const expression = withTime
    ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
    : /^\d{4}-\d{2}-\d{2}$/;
  if (!expression.test(date)) throw new Error(`${label} invalide.`);
  const probe = new Date(`${date}${withTime ? ":00" : "T00:00:00"}Z`);
  if (
    !Number.isFinite(probe.getTime()) ||
    probe.toISOString().slice(0, date.length) !== date
  )
    throw new Error(`${label} invalide.`);
  return date;
}

function timestamp(value: unknown, label: string): string {
  const stamp = string(value, label, 40);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(stamp) || !Number.isFinite(Date.parse(stamp)))
    throw new Error(`${label} invalide.`);
  return stamp;
}

function uniqueStrings(value: unknown, label: string, max: number): string[] {
  const values = array(value, label, max).map((entry) =>
    nonempty(entry, label, 200),
  );
  if (new Set(values).size !== values.length)
    throw new Error(`${label} contient des doublons.`);
  return values;
}

function validateData(value: unknown): AppData {
  const data = object(value, "Données");
  const categories: Category[] = array(data.categories, "Catégories", 1000).map(
    (entry) => {
      const category = object(entry, "Catégorie");
      const color = string(category.color, "Couleur", 7);
      if (!/^#[\da-f]{6}$/i.test(color))
        throw new Error("Couleur de catégorie invalide.");
      return {
        id: nonempty(category.id, "Identifiant de catégorie", 200),
        name: nonempty(category.name, "Nom de catégorie", 100),
        icon: string(category.icon, "Icône", 32),
        color,
      };
    },
  );
  if (
    !categories.length ||
    new Set(categories.map((item) => item.id)).size !== categories.length
  )
    throw new Error(
      "La liste des catégories est vide ou contient des doublons.",
    );
  const settingsInput = object(data.settings, "Réglages");
  const settings: Settings = {
    theme: choice(settingsInput.theme, ["system", "light", "dark"], "Thème"),
    region: choice(settingsInput.region, ["fr", "alsace"], "Région"),
    showHolidays: boolean(
      settingsInput.showHolidays,
      "Affichage des jours fériés",
    ),
    defaultAlert: integer(
      settingsInput.defaultAlert,
      "Rappel par défaut",
      -1,
      10080,
    ),
    timezone: timezone(settingsInput.timezone),
  };
  const categoryIds = new Set(categories.map((category) => category.id));
  const usedAttachmentIds = new Set<string>();
  const events: CalendarEvent[] = array(data.events, "Événements", 100000).map(
    (entry) => {
      const event = object(entry, "Événement");
      const start = localDate(event.start, "Début");
      const end = localDate(event.end, "Fin");
      if (end <= start)
        throw new Error("La fin de l’événement doit suivre son début.");
      const allDay = boolean(event.allDay, "Journée entière");
      if (allDay && (!start.endsWith("T00:00") || !end.endsWith("T00:00")))
        throw new Error(
          "Un événement en journée entière doit commencer et finir à minuit.",
        );
      const categoryId = nonempty(
        event.categoryId,
        "Catégorie de l’événement",
        200,
      );
      if (!categoryIds.has(categoryId))
        throw new Error("Une catégorie d’événement est introuvable.");
      const recurrenceInput = object(event.recurrence, "Récurrence");
      const recurrence: CalendarEvent["recurrence"] = {
        frequency: choice(
          recurrenceInput.frequency,
          ["none", "daily", "weekly", "monthly", "yearly"],
          "Fréquence",
        ),
        interval: integer(
          recurrenceInput.interval,
          "Intervalle de récurrence",
          1,
          365,
        ),
      };
      if (recurrenceInput.until !== undefined) {
        recurrence.until = localDate(
          recurrenceInput.until,
          "Fin de récurrence",
          false,
        );
        if (recurrence.until < start.slice(0, 10))
          throw new Error(
            "La récurrence se termine avant le début de l’événement.",
          );
      }
      const url = string(event.url, "Lien", 4000);
      if (url) {
        try {
          if (!["https:", "http:"].includes(new URL(url).protocol))
            throw new Error();
        } catch {
          throw new Error(
            "Les liens doivent commencer par https:// ou http://.",
          );
        }
      }
      const alerts = array(event.alerts, "Rappels", 10).map((alert) =>
        integer(alert, "Délai du rappel", 0, 525600),
      );
      if (new Set(alerts).size !== alerts.length)
        throw new Error("Les rappels contiennent des doublons.");
      const attachmentIds = uniqueStrings(
        event.attachmentIds,
        "Documents de l’événement",
        1000,
      );
      for (const id of attachmentIds) {
        if (usedAttachmentIds.has(id))
          throw new Error(
            "Un même document est associé à plusieurs événements.",
          );
        usedAttachmentIds.add(id);
      }
      return {
        id: nonempty(event.id, "Identifiant de l’événement", 200),
        uid: nonempty(event.uid, "UID de l’événement", 500),
        title: nonempty(event.title, "Titre", 500),
        start,
        end,
        allDay,
        categoryId,
        icon: string(event.icon, "Icône", 32),
        location: string(event.location, "Lieu", 2000),
        notes: string(event.notes, "Notes", 100000),
        url,
        availability: choice(
          event.availability,
          ["busy", "free"],
          "Disponibilité",
        ),
        alerts,
        recurrence,
        timezone: timezone(event.timezone),
        attachmentIds,
        createdAt: timestamp(event.createdAt, "Date de création"),
        updatedAt: timestamp(event.updatedAt, "Date de modification"),
        ...(event.batchId === undefined
          ? {}
          : { batchId: nonempty(event.batchId, "Identifiant du groupe", 200) }),
      };
    },
  );
  if (
    new Set(events.map((event) => event.id)).size !== events.length ||
    new Set(events.map((event) => event.uid)).size !== events.length
  )
    throw new Error("La sauvegarde contient des événements en double.");
  return { events, categories, settings };
}
