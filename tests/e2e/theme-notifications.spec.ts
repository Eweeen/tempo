import { expect, test, type Page } from '@playwright/test';

async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Calendriers', exact: true }).click();
  await page.getByRole('button', { name: 'Ouvrir les préférences', exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-09T09:00:00+01:00') });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'novembre 2026', exact: true })).toBeVisible();
});

for (const mobile of [false, true]) {
  test(`applies both themes to the calendar, dialogs and toasts on ${mobile ? 'mobile' : 'desktop'}`, async ({ page }, testInfo) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Revenir à l’année', exact: true }).click();
    await expect(page.locator('[data-year="2026"] .year-month-name').first()).toHaveCSS('color', 'rgb(28, 28, 30)');

    for (const theme of [
      { label: 'Sombre', id: 'dark', bg: 'rgb(14, 14, 16)', text: 'rgb(245, 245, 247)', soft: 'rgb(27, 27, 30)', accent: 'rgb(184, 50, 56)', errorBg: 'rgb(56, 36, 38)', errorText: 'rgb(240, 149, 149)', noticeBg: 'rgb(53, 46, 36)' },
      { label: 'Clair', id: 'light', bg: 'rgb(255, 255, 255)', text: 'rgb(28, 28, 30)', soft: 'rgb(245, 245, 247)', accent: 'rgb(196, 59, 66)', errorBg: 'rgb(255, 241, 239)', errorText: 'rgb(181, 48, 48)', noticeBg: 'rgb(251, 245, 233)' },
    ]) {
      await openSettings(page);
      const dialog = page.getByRole('dialog', { name: 'Réglages', exact: true });
      await dialog.getByRole('button', { name: theme.label, exact: true }).click();
      await dialog.getByRole('button', { name: 'Enregistrer les préférences', exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme.id);
      for (const surface of ['html', 'body', '#root', '.app-shell']) {
        await expect(page.locator(surface)).toHaveCSS('background-color', theme.bg);
      }
      await expect(dialog).toHaveCSS('background-color', theme.bg);
      await expect(dialog.getByRole('combobox', { name: 'Rappel par défaut', exact: true })).toHaveCSS('background-color', theme.soft);
      const toast = dialog.locator('.toast');
      await expect(toast).toContainText('Préférences enregistrées.');
      await expect(dialog.locator('.toast-region')).toHaveAttribute('role', 'status');
      await expect(dialog.locator('.toast-region')).toHaveCSS('position', 'fixed');
      await expect(toast).toHaveCSS('background-color', theme.bg);
      await expect(toast).toHaveCSS('color', theme.text);
      await expect(dialog.locator('.dialog-body .success-message')).toHaveCount(0);
      expect(await toast.evaluate(el => {
        const rect = el.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight && el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      })).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${theme.id}-toast.png`) });
      await toast.getByRole('button', { name: 'Fermer la notification' }).click();
      await expect(toast).toHaveCount(0);

      await dialog.getByRole('button', { name: 'Mes données', exact: true }).click();
      await expect(dialog.locator('.notice')).toHaveCSS('background-color', theme.noticeBg);
      await dialog.locator('input[type="file"][accept=".json,application/json"]').setInputFiles({ name: 'invalide.json', mimeType: 'application/json', buffer: Buffer.from('{invalid') });
      await dialog.getByRole('button', { name: 'Remplacer et restaurer', exact: true }).click();
      await expect(dialog.getByRole('alert')).toBeVisible();
      await expect(dialog.getByRole('alert')).toHaveCSS('background-color', theme.errorBg);
      await expect(dialog.getByRole('alert')).toHaveCSS('color', theme.errorText);
      await dialog.getByRole('button', { name: 'Fermer', exact: true }).last().click();

      await expect(page.locator('[data-year="2026"] .year-month-name').first()).toHaveCSS('color', theme.text);
      await expect(page.getByRole('button', { name: 'Ouvrir novembre 2026', exact: true }).locator('.year-month-name')).toHaveCSS('color', theme.accent);
      await expect(page.getByRole('button', { name: 'Ouvrir novembre 2025', exact: true }).locator('.year-month-name')).toHaveCSS('color', theme.text);
      await page.screenshot({ path: testInfo.outputPath(`${theme.id}-year.png`) });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await openSettings(page);
    await page.getByRole('button', { name: 'Automatique', exact: true }).click();
    await page.getByRole('button', { name: 'Enregistrer les préférences', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });
}

test('renews identical confirmation toasts and keeps them after closing settings', async ({ page }) => {
  await openSettings(page);
  const save = page.getByRole('button', { name: 'Enregistrer les préférences', exact: true });
  await save.click();
  await expect(page.locator('.toast')).toContainText('Préférences enregistrées.');
  await page.clock.fastForward(5000);
  await save.click();
  await expect(save).toBeEnabled();
  await page.clock.fastForward(2000);
  await expect(page.locator('.toast')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Fermer', exact: true }).last().click();
  await expect(page.locator('.toast')).toContainText('Préférences enregistrées.');
  await page.clock.fastForward(5000);
  await expect(page.locator('.toast')).toHaveCount(0);
});
