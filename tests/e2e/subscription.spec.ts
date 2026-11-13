import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function openData(page: Page) {
  await page.getByRole('button', { name: 'Calendriers', exact: true }).click();
  await page.getByRole('button', { name: 'Importer ou exporter', exact: true }).click();
}
async function closeDialog(page: Page) {
  await page.getByLabel('Fermer', { exact: true }).click();
}
async function createEvent(page: Page, title: string) {
  await page.getByRole('button', { name: 'Nouvel événement', exact: true }).click();
  await page.getByLabel('Titre de l’événement').fill(title);
  await page.getByLabel('Rappel 1', { exact: true }).selectOption('-1');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-09T09:00:00+01:00'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'novembre 2026' })).toBeVisible();
});

test('offers Aucun, persists no reminder, then allows adding a reminder again', async ({ page }) => {
  await createEvent(page, 'Sans rappel');
  await page.reload();
  await page.locator('.month-grid .event-chip').filter({ hasText: 'Sans rappel' }).click();
  await expect(page.getByLabel('Rappel 1', { exact: true })).toHaveValue('-1');
  await page.getByLabel('Rappel 1', { exact: true }).selectOption('0');
  await page.getByRole('button', { name: 'Ajouter un rappel', exact: true }).click();
  await page.getByLabel('Rappel 1', { exact: true }).selectOption('-1');
  await expect(page.getByLabel('Rappel 1', { exact: true })).toHaveValue('5');
  await expect(page.getByLabel('Rappel 2', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await page.locator('.month-grid .event-chip').filter({ hasText: 'Sans rappel' }).click();
  await expect(page.getByLabel('Rappel 1', { exact: true })).toHaveValue('5');
});

test('publishes opt-in, updates a stable feed, retries offline changes and revokes access', async ({ page, context, request }) => {
  let uploads = 0;
  page.on('request', req => { if (req.url().endsWith('/api/subscription') && req.method() === 'PUT') uploads++; });
  await createEvent(page, 'Événement Apple');
  expect(uploads).toBe(0);
  await openData(page);
  await page.getByRole('button', { name: 'Activer l’abonnement', exact: true }).click();
  const link = page.getByLabel('Lien privé d’abonnement');
  await expect(link).toBeVisible();
  const url = await link.inputValue();
  await expect(page.getByRole('link', { name: 'S’abonner dans Calendrier Apple' })).toHaveAttribute('href', url.replace(/^http:/, 'webcal:'));
  const first = await (await request.get(url)).text();
  expect(first).toContain('SUMMARY:Événement Apple');
  expect(first).not.toContain('VALARM');
  const uid = first.match(/UID:(.*)/)![1];

  await closeDialog(page);
  await page.locator('.month-grid .event-chip').filter({ hasText: 'Événement Apple' }).click();
  await page.getByLabel('Titre de l’événement').fill('Événement modifié');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect.poll(async () => (await request.get(url)).text()).toContain('SUMMARY:Événement modifié');
  expect(await (await request.get(url)).text()).toContain(`UID:${uid}`);

  await context.setOffline(true);
  await createEvent(page, 'Ajout hors connexion');
  await context.setOffline(false);
  await expect.poll(async () => (await request.get(url)).text()).toContain('SUMMARY:Ajout hors connexion');
  await page.reload();
  await openData(page);
  await expect(page.getByLabel('Lien privé d’abonnement')).toHaveValue(url);
  await closeDialog(page);

  for (const title of ['Événement modifié', 'Ajout hors connexion']) {
    await page.locator('.month-grid .event-chip').filter({ hasText: title }).click();
    await page.getByRole('button', { name: 'Supprimer l’événement', exact: true }).click();
    await page.getByRole('button', { name: 'Confirmer la suppression', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
  }
  await expect.poll(async () => (await request.get(url)).text()).not.toContain('BEGIN:VEVENT');
  // Navigating to a feed must bypass the installed service worker's app shell.
  const downloaded = page.waitForEvent('download');
  await page.goto(url).catch(error => {
    if (!error.message.includes('Download is starting')) throw error;
  });
  const file = await downloaded;
  expect(await readFile((await file.path())!, 'utf8')).toContain('BEGIN:VCALENDAR');
  await page.goto('/');
  await openData(page);
  await page.getByRole('button', { name: 'Désactiver l’abonnement', exact: true }).click();
  await page.getByRole('button', { name: 'Révoquer le lien', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Activer l’abonnement', exact: true })).toBeVisible();
  expect((await request.get(url)).status()).toBe(404);
  await page.getByRole('button', { name: 'Activer l’abonnement', exact: true }).click();
  await expect(page.getByLabel('Lien privé d’abonnement')).toBeVisible();
  expect(await page.getByLabel('Lien privé d’abonnement').inputValue()).not.toBe(url);
  await expect(page.getByRole('button', { name: 'Révoquer le lien', exact: true })).toHaveCount(0);
});

test('a stale tab publishes current storage and cannot overwrite a newer event', async ({ page, context, request }) => {
  await createEvent(page, 'Version initiale');
  await openData(page);
  await page.getByRole('button', { name: 'Activer l’abonnement', exact: true }).click();
  await expect(page.getByLabel('Lien privé d’abonnement')).toBeVisible();
  const url = await page.getByLabel('Lien privé d’abonnement').inputValue();
  const other = await context.newPage();
  await other.clock.setFixedTime(new Date('2026-11-09T09:00:00+01:00'));
  await other.goto('/');
  await other.locator('.month-grid .event-chip').filter({ hasText: 'Version initiale' }).click();
  await other.getByLabel('Titre de l’événement').fill('Nouvelle version');
  await other.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await page.getByRole('button', { name: 'Publier maintenant', exact: true }).click();
  await expect.poll(async () => (await request.get(url)).text()).toContain('SUMMARY:Nouvelle version');
  await closeDialog(page);
  await page.locator('.month-grid .event-chip').filter({ hasText: 'Version initiale' }).click();
  await page.getByLabel('Titre de l’événement').fill('Écrasement interdit');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('autre onglet');
  expect(await (await request.get(url)).text()).not.toContain('Écrasement interdit');
});
