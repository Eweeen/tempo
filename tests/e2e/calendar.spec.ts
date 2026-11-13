import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

async function openWorkPlanner(page: Page) {
  await page.getByRole('button', { name: 'Ma semaine de travail', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Ma semaine de travail' })).toBeVisible();
}

async function openCalendarAction(page: Page, name: string) {
  await page.getByRole('button', { name: 'Calendriers', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
}

async function chooseDisplay(page: Page, name: string) {
  await page.getByRole('button', { name: 'Choisir l’affichage', exact: true }).click();
  await page.getByRole('menuitemradio', { name, exact: true }).click();
}

async function createWorkWeek(page: Page) {
  await openWorkPlanner(page);
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Semaine du lundi').fill('2026-11-09');
  await dialog.getByRole('button', { name: /Du matin/ }).click();
  await dialog.getByLabel('Titre', { exact: true }).fill('Travail du matin');
  await dialog.getByRole('combobox', { name: 'Rappel', exact: true }).selectOption('30');
  await expect(dialog.getByText('5 événements à créer', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Ajouter ma semaine' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.month-grid .event-chip')).toHaveCount(5);
}

test.beforeEach(async ({ page }) => {
  // Fix Date only: let timers, downloads and service worker installation run.
  await page.clock.setFixedTime(new Date('2026-11-09T09:00:00+01:00'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'novembre 2026' })).toBeVisible();
  await expect(page.getByRole('complementary')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('creates five independent morning shifts, prevents duplicates and exports reminders', async ({ page }, testInfo) => {
  await createWorkWeek(page);
  await expect(page.locator('.month-grid .event-chip')).toHaveCount(5);
  await expect(page.locator('.month-grid .event-chip').first()).toContainText('05h00');
  await page.screenshot({ path: testInfo.outputPath('desktop.png'), fullPage: true });

  await openWorkPlanner(page);
  const planner = page.getByRole('dialog');
  await planner.getByLabel('Titre', { exact: true }).fill('Travail du matin');
  await planner.getByRole('combobox', { name: 'Rappel', exact: true }).selectOption('30');
  await expect(planner.getByText('0 événement à créer', { exact: true })).toBeVisible();
  await planner.getByRole('button', { name: 'Ajouter ma semaine' }).click();
  await expect(planner.getByRole('alert')).toContainText('existent déjà');
  await planner.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect(page.locator('.month-grid .event-chip')).toHaveCount(5);

  await openCalendarAction(page, 'Importer ou exporter');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exporter les événements', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('tempo-calendrier.ics');
  const path = await download.path();
  expect(path).toBeTruthy();
  const calendar = await readFile(path!, 'utf8');
  expect(calendar.match(/BEGIN:VEVENT/g)).toHaveLength(5);
  expect(calendar.match(/BEGIN:VALARM/g)).toHaveLength(5);
  expect(calendar).toContain('TRIGGER:-PT30M');
  expect(calendar).toContain('DTSTART;TZID=Europe/Paris:20261109T050000');
  expect(calendar).toContain('DTEND;TZID=Europe/Paris:20261113T130000');
  expect(new Set([...calendar.matchAll(/^UID:(.*)$/gm)].map(match => match[1])).size).toBe(5);
});

test('edits one shift, keeps document bytes after reload and deletes only that event', async ({ page }) => {
  await createWorkWeek(page);
  await page.locator('.month-grid .event-chip').first().click();
  const editor = page.getByRole('dialog', { name: 'Modifier l’événement' });
  await editor.getByLabel('Titre de l’événement').fill('Travail avec formation');
  await editor.getByRole('textbox', { name: 'Notes', exact: true }).fill('Prévoir le badge et le document de formation.');
  await editor.getByLabel('Ajouter des documents', { exact: true }).setInputFiles({ name: 'formation.txt', mimeType: 'text/plain', buffer: Buffer.from('Formation : rendez-vous à 05:00.\n') });
  await editor.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(editor).toBeHidden();
  await page.reload();
  const edited = page.locator('.month-grid .event-chip').filter({ hasText: 'Travail avec formation' });
  await expect(edited).toBeVisible();
  await edited.click();
  await expect(page.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue('Prévoir le badge et le document de formation.');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Télécharger formation.txt' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('formation.txt');
  expect(await readFile((await download.path())!, 'utf8')).toBe('Formation : rendez-vous à 05:00.\n');

  await page.getByRole('button', { name: 'Supprimer l’événement', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmer la suppression' }).click();
  await expect(editor).toBeHidden();
  await expect(page.locator('.month-grid .event-chip')).toHaveCount(4);
  await page.reload();
  await expect(page.locator('.month-grid .event-chip')).toHaveCount(4);
});

test('switches calendar views and preserves a dark theme', async ({ page }, testInfo) => {
  await createWorkWeek(page);
  await chooseDisplay(page, 'Semaine');
  await expect(page.locator('.timed-event')).toHaveCount(5);
  await expect(page.locator('.timed-event').first()).toContainText('05h00 – 13h00');
  await chooseDisplay(page, 'Liste');
  await expect(page.locator('.agenda-event')).toHaveCount(5);
  await expect(page.locator('.agenda-holiday').filter({ hasText: 'Armistice' })).toBeVisible();

  await openCalendarAction(page, 'Ouvrir les préférences');
  await page.getByRole('button', { name: 'Sombre', exact: true }).click();
  await page.getByRole('button', { name: 'Enregistrer les préférences', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.month-grid .event-chip')).toHaveCount(5);
  await page.screenshot({ path: testInfo.outputPath('dark.png'), fullPage: true });
});

test('previews a compatible ICS import and skips the same UID on a second import', async ({ page }) => {
  const calendar = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:concert-import@tempo.test', 'DTSTART;TZID=Europe/Paris:20261112T200000', 'DTEND;TZID=Europe/Paris:20261112T230000', 'SUMMARY:Concert importé', 'LOCATION:Rennes', 'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT60M', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
  await openCalendarAction(page, 'Importer ou exporter');
  const input = page.locator('input[type="file"][accept=".ics,text/calendar"]');
  await input.setInputFiles({ name: 'concert.ics', mimeType: 'text/calendar', buffer: Buffer.from(calendar) });
  await expect(page.getByText('1 nouvel événement à importer', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmer l’import', exact: true }).click();
  await expect(page.getByText('Événements importés.', { exact: true })).toBeVisible();
  await input.setInputFiles({ name: 'concert.ics', mimeType: 'text/calendar', buffer: Buffer.from(calendar) });
  await expect(page.getByText('0 nouvel événement à importer', { exact: true })).toBeVisible();
  await expect(page.getByText('1 doublon(s) ignoré(s) grâce à l’identifiant du calendrier.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmer l’import', exact: true })).toBeDisabled();
  await page.getByRole('dialog').getByRole('button', { name: 'Fermer', exact: true }).last().click();
  await expect(page.locator('.month-grid .event-chip')).toHaveCount(1);
  await page.locator('.month-grid .event-chip').click();
  await expect(page.getByLabel('Rappel 1', { exact: true })).toHaveValue('60');
  await expect(page.getByLabel('Lieu', { exact: true })).toHaveValue('Rennes');
});

test('keeps the app and events available after an offline reload', async ({ page, context }) => {
  await createWorkWeek(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return;
    await new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
  });
  await expect(page.locator('.app-shell')).toHaveAttribute('data-offline-ready', 'true');
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.month-grid .event-chip')).toHaveCount(5);
  await expect(page.getByRole('status', { name: 'Hors connexion', exact: true })).toBeVisible();
  await page.locator('.month-grid .event-chip').first().click();
  await page.getByLabel('Titre de l’événement').fill('Travail modifié hors connexion');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.month-grid .event-chip').filter({ hasText: 'Travail modifié hors connexion' })).toBeVisible();
});

test('remains usable at 390px without page or dialog overflow', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Calendriers', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await openWorkPlanner(page);
  await expect(page.getByLabel('Semaine du lundi')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const dialogBounds = await page.getByRole('dialog').boundingBox();
  expect(dialogBounds).toBeTruthy();
  expect(dialogBounds!.x).toBeGreaterThanOrEqual(0);
  expect(dialogBounds!.x + dialogBounds!.width).toBeLessThanOrEqual(391);
  await page.getByLabel('Titre', { exact: true }).fill('Travail mobile');
  await page.getByRole('button', { name: 'Ajouter ma semaine' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('mobile-month.png'), fullPage: true });
  await page.getByRole('button', { name: 'Sélectionner le lundi 9 novembre', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'lundi 9 novembre', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Semaine', exact: true })).toHaveCount(0);
  await page.locator('.day-page[data-active="true"] .timed-event').click();
  await expect(page.getByLabel('Titre de l’événement')).toHaveValue('Travail mobile');
  await page.getByRole('button', { name: 'Fermer', exact: true }).click();
  await page.getByRole('button', { name: 'Revenir aux mois', exact: true }).click();
  await chooseDisplay(page, 'Liste');
  await expect(page.locator('.agenda-event')).toHaveCount(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
});

test('creates a bounded all-day recurring series with an exclusive exported end', async ({ page }) => {
  await page.locator('.create-button').click();
  const editor = page.getByRole('dialog', { name: 'Nouvel événement', exact: true });
  await editor.getByLabel('Titre de l’événement').fill('Journée de formation');
  await editor.getByRole('switch', { name: 'Toute la journée', exact: true }).check();
  await editor.getByLabel('Date de début', { exact: true }).fill('2026-11-09');
  await editor.getByLabel('Date de fin', { exact: true }).fill('2026-11-09');
  await editor.getByRole('combobox', { name: 'Répéter', exact: true }).selectOption('weekly');
  await editor.getByLabel('Jusqu’au (facultatif)', { exact: true }).fill('2026-11-23');
  await editor.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(page.locator('.month-grid .event-chip.all-day')).toHaveCount(3);
  await expect(page.locator('.month-grid .event-chip')).toHaveCount(3);
  await page.reload();
  await expect(page.locator('.month-grid .event-chip.all-day')).toHaveCount(3);
  await page.locator('.month-grid .event-chip.all-day').last().click();
  await expect(page.getByText('Les modifications concernent toute la série.', { exact: true })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Toute la journée', exact: true })).toBeChecked();
  await expect(page.getByLabel('Date de fin', { exact: true })).toHaveValue('2026-11-09');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exporter la version enregistrée de cet événement', exact: true }).click();
  const download = await downloadPromise;
  const calendar = await readFile((await download.path())!, 'utf8');
  expect(calendar.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  expect(calendar).toContain('DTSTART;VALUE=DATE:20261109');
  expect(calendar).toContain('DTEND;VALUE=DATE:20261110');
  expect(calendar).toContain('RRULE:FREQ=WEEKLY;INTERVAL=1;UNTIL=20261123');
});

test('backs up and restores document bytes and event data through the interface', async ({ page }) => {
  await page.locator('.create-button').click();
  await page.getByLabel('Titre de l’événement').fill('Concert avec billet');
  await page.getByRole('textbox', { name: 'Notes', exact: true }).fill('Billet à conserver dans la sauvegarde.');
  const documentBytes = Buffer.from('Billet numéro 42 · entrée 20:00\n');
  await page.getByLabel('Ajouter des documents', { exact: true }).setInputFiles({ name: 'billet.txt', mimeType: 'text/plain', buffer: documentBytes });
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  await openCalendarAction(page, 'Importer ou exporter');
  const backupPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Sauvegarder', exact: true }).click();
  const backup = await backupPromise;
  const backupPath = (await backup.path())!;
  const exported = JSON.parse(await readFile(backupPath, 'utf8'));
  expect(exported.data.events).toHaveLength(1);
  expect(exported.attachments).toHaveLength(1);
  expect(Buffer.from(exported.attachments[0].base64, 'base64')).toEqual(documentBytes);
  await page.getByRole('dialog').getByRole('button', { name: 'Fermer', exact: true }).last().click();

  await page.locator('.month-grid .event-chip').click();
  await page.getByRole('button', { name: 'Supprimer l’événement', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmer la suppression', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('.month-grid .event-chip')).toHaveCount(0);

  await openCalendarAction(page, 'Importer ou exporter');
  await page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles(backupPath);
  await expect(page.getByRole('button', { name: 'Remplacer et restaurer', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remplacer et restaurer', exact: true }).click();
  await expect(page.getByText('Sauvegarde restaurée.', { exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Fermer', exact: true }).last().click();
  await page.reload();
  await expect(page.locator('.month-grid .event-chip')).toHaveCount(1);
  await page.locator('.month-grid .event-chip').click();
  await expect(page.getByLabel('Titre de l’événement')).toHaveValue('Concert avec billet');
  await expect(page.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue('Billet à conserver dans la sauvegarde.');
  const documentPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Télécharger billet.txt', exact: true }).click();
  const document = await documentPromise;
  expect(await readFile((await document.path())!)).toEqual(documentBytes);
});

test('prevents a stale tab from overwriting events saved in another tab', async ({ page, context }) => {
  const other = await context.newPage();
  await other.clock.setFixedTime(new Date('2026-11-09T09:00:00+01:00'));
  await other.goto('/');
  await expect(other.getByRole('heading', { name: 'novembre 2026' })).toBeVisible();
  await expect(other.locator('.month-grid .event-chip')).toHaveCount(0);

  await createWorkWeek(page);
  await openCalendarAction(other, 'Ouvrir les préférences');
  await other.getByRole('button', { name: 'Sombre', exact: true }).click();
  await other.getByRole('button', { name: 'Enregistrer les préférences', exact: true }).click();
  await expect(other.getByRole('dialog').getByRole('alert')).toContainText(/autre onglet|recharg/i);
  await page.reload();
  await expect(page.locator('.month-grid .event-chip')).toHaveCount(5);

  await other.reload();
  await expect(other.locator('.month-grid .event-chip')).toHaveCount(5);
  await openCalendarAction(other, 'Ouvrir les préférences');
  await other.getByRole('button', { name: 'Sombre', exact: true }).click();
  await other.getByRole('button', { name: 'Enregistrer les préférences', exact: true }).click();
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(other.getByRole('dialog').getByRole('alert')).toHaveCount(0);
  await other.reload();
  await expect(other.locator('.month-grid .event-chip')).toHaveCount(5);
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'dark');
  await other.close();
});
