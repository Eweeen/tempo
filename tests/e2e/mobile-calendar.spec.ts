import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const calendar = [
  ['overnight', 'Travail de nuit', '20261108T210000', '20261109T090000'],
  ['morning', 'Formation', '20261109T080000', '20261109T100000'],
  ['lunch', 'Déjeuner', '20261109T120000', '20261109T130000'],
  ['sport', 'Sport', '20261109T140000', '20261109T150000'],
  ['evening', 'Concert', '20261109T190000', '20261109T220000'],
].map(([uid, title, start, end]) => ['BEGIN:VEVENT', `UID:${uid}@mobile.test`, `SUMMARY:${title}`, `DTSTART;TZID=Europe/Paris:${start}`, `DTEND;TZID=Europe/Paris:${end}`, 'END:VEVENT'].join('\r\n'));
const fixture = ['BEGIN:VCALENDAR', 'VERSION:2.0', ...calendar, 'BEGIN:VEVENT', 'UID:birthday@mobile.test', 'SUMMARY:Anniversaire', 'DTSTART;VALUE=DATE:20261110', 'DTEND;VALUE=DATE:20261111', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');

async function swipe(page: Page, start: { x: number; y: number }, end: { x: number; y: number }, beforeRelease?: () => Promise<void>) {
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] });
  for (let step = 1; step <= 10; step++) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + (end.x - start.x) * step / 10, y: start.y + (end.y - start.y) * step / 10, id: 1 }] });
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  try {
    await beforeRelease?.();
  } finally {
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();
  }
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-09T09:00:00+01:00'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'novembre 2026', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Calendriers', exact: true }).click();
  await page.getByRole('button', { name: 'Importer ou exporter', exact: true }).click();
  await page.locator('input[type="file"][accept=".ics,text/calendar"]').setInputFiles({ name: 'mobile.ics', mimeType: 'text/calendar', buffer: Buffer.from(fixture) });
  await page.getByRole('button', { name: 'Confirmer l’import', exact: true }).click();
  await expect(page.getByText('Événements importés.', { exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Fermer', exact: true }).last().click();
});

for (const view of ['months', 'years'] as const) {
  test(`keeps ${view} stable while a finger crosses the window boundary and after release`, async ({ page }) => {
    if (view === 'years') await page.getByRole('button', { name: 'Revenir à l’année', exact: true }).click();
    const scroll = page.getByLabel(view === 'months' ? 'Mois défilants' : 'Années défilantes', { exact: true });
    const attribute = view === 'months' ? 'data-month' : 'data-year';
    const step = view === 'months' ? 3 : 2;
    for (const { direction, hold } of [{ direction: 1, hold: true }, { direction: -1, hold: true }, { direction: 1, hold: false }]) {
      const first = Number(await scroll.locator(`[${attribute}]`).first().getAttribute(attribute));
      // Start outside the recycling threshold, then cross it with a real touch gesture.
      await scroll.evaluate((el, direction) => {
        el.scrollTop = direction > 0 ? el.scrollHeight - el.clientHeight * 2 - 100 : el.clientHeight + 100;
      }, direction);
      let anchor: { index: string; offset: number };
      await swipe(page,
        { x: 200, y: direction > 0 ? 610 : 270 },
        { x: 200, y: direction > 0 ? 270 : 610 },
        hold ? async () => {
          // Hold the finger still: neither the DOM window nor its visible dates may jump.
          await scroll.evaluate(() => new Promise(resolve => setTimeout(resolve, 250)));
          await expect(scroll.locator(`[${attribute}]`).first()).toHaveAttribute(attribute, String(first));
          anchor = await scroll.evaluate((el, attribute) => {
            const top = el.getBoundingClientRect().top;
            const node = [...el.querySelectorAll<HTMLElement>(`[${attribute}]`)].find(node => node.getBoundingClientRect().bottom > top + 1)!;
            return { index: node.getAttribute(attribute)!, offset: node.getBoundingClientRect().top - top };
          }, attribute);
        } : undefined,
      );
      await expect(scroll.locator(`[${attribute}]`).first()).toHaveAttribute(attribute, String(first + direction * step));
      if (hold) {
        const expectedAnchor = scroll.locator(`[${attribute}="${anchor!.index}"]`);
        await expect.poll(() => expectedAnchor.evaluate(el => el.getBoundingClientRect().top - el.parentElement!.getBoundingClientRect().top)).toBeCloseTo(anchor!.offset, 0);
      }
      // Observe multiple idle frames to catch a correction that starts another automatic shift.
      const positions = await scroll.evaluate(async (el, attribute) => {
        const samples = [];
        for (let frame = 0; frame < 45; frame++) {
          await new Promise(requestAnimationFrame);
          samples.push({ first: el.firstElementChild!.getAttribute(attribute), top: el.scrollTop });
        }
        return samples;
      }, attribute);
      expect(new Set(positions.map(position => position.first)).size).toBe(1);
      expect(Math.max(...positions.map(position => position.top)) - Math.min(...positions.map(position => position.top))).toBeLessThan(2);
    }
  });
}

test('shows three previews, opens a full day and swipes between days without blocking vertical scroll', async ({ page }, testInfo) => {
  await expect(page.getByRole('button', { name: 'Semaine', exact: true })).toHaveCount(0);
  const month = page.locator('.calendar-month[aria-label="novembre 2026"]');
  await expect(month.locator('.month-cell')).toHaveCount(30);
  const ninth = month.locator('[data-date="2026-11-09"]');
  await expect(ninth.locator('.event-chip')).toHaveCount(3);
  await expect(ninth.locator('.event-chip').first()).toBeVisible();
  await expect(ninth.getByRole('button', { name: 'Voir les 5 événements du lundi 9 novembre' })).toContainText('+2');
  await page.screenshot({ path: testInfo.outputPath('mobile-months.png') });

  await ninth.getByRole('button', { name: 'Sélectionner le lundi 9 novembre', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'lundi 9 novembre', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.day-page[data-active="true"] .timed-event')).toHaveCount(5);
  await expect(page.locator('.day-page[data-active="true"] strong').filter({ hasText: 'Travail de nuit' })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('mobile-day.png') });

  await swipe(page, { x: 320, y: 350 }, { x: 65, y: 353 });
  await expect(page.getByRole('heading', { name: 'mardi 10 novembre', exact: true })).toBeVisible();
  await expect(page.locator('.day-all-day')).toContainText('Anniversaire');
  await swipe(page, { x: 65, y: 350 }, { x: 320, y: 352 });
  await expect(page.getByRole('heading', { name: 'lundi 9 novembre', exact: true })).toBeVisible();
  const before = await page.locator('.day-scroll').evaluate(el => el.scrollTop);
  await swipe(page, { x: 200, y: 600 }, { x: 204, y: 300 });
  await expect.poll(() => page.locator('.day-scroll').evaluate(el => el.scrollTop)).toBeGreaterThan(before + 100);
  await expect(page.getByRole('heading', { name: 'lundi 9 novembre', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('button', { name: 'Jour suivant', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'mardi 10 novembre', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Revenir aux mois', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'novembre 2026', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('extends months in both directions without a scroll jump and returns to today', async ({ page }) => {
  const scroll = page.getByLabel('Mois défilants', { exact: true });
  const initialFirst = await scroll.locator('.calendar-month').first().getAttribute('data-month');
  for (let step = 0; step < 4; step++) {
    const before = await scroll.evaluate(el => {
      el.scrollTop = el.scrollHeight - el.clientHeight - 3;
      const top = el.getBoundingClientRect().top;
      const anchor = [...el.querySelectorAll<HTMLElement>('[data-month]')].find(node => node.getBoundingClientRect().bottom > top + 1)!;
      return { first: Number(el.firstElementChild?.getAttribute('data-month')), anchor: anchor.dataset.month!, offset: anchor.getBoundingClientRect().top - top };
    });
    await expect.poll(async () => Number(await scroll.locator('.calendar-month').first().getAttribute('data-month'))).toBe(before.first + 3);
    await expect(scroll.locator('.calendar-month')).toHaveCount(9);
    const offset = await scroll.locator(`[data-month="${before.anchor}"]`).evaluate(el => el.getBoundingClientRect().top - el.parentElement!.getBoundingClientRect().top);
    expect(Math.abs(offset - before.offset)).toBeLessThan(2);
  }
  expect(Number(await scroll.locator('.calendar-month').first().getAttribute('data-month'))).toBe(Number(initialFirst) + 12);

  for (let step = 0; step < 3; step++) {
    const before = await scroll.evaluate(el => {
      el.scrollTop = 2;
      const anchor = el.querySelector<HTMLElement>('[data-month]')!;
      return { first: Number(anchor.dataset.month), offset: anchor.getBoundingClientRect().top - el.getBoundingClientRect().top };
    });
    await expect.poll(async () => Number(await scroll.locator('.calendar-month').first().getAttribute('data-month'))).toBe(before.first - 3);
    const offset = await scroll.locator(`[data-month="${before.first}"]`).evaluate(el => el.getBoundingClientRect().top - el.parentElement!.getBoundingClientRect().top);
    expect(Math.abs(offset - before.offset)).toBeLessThan(2);
  }

  await page.getByRole('button', { name: 'Aujourd’hui', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'novembre 2026', exact: true })).toBeVisible();
  await expect.poll(() => scroll.locator('.calendar-month[aria-label="novembre 2026"]').evaluate(el => Math.abs(el.getBoundingClientRect().top - el.parentElement!.getBoundingClientRect().top))).toBeLessThan(2);
  await page.getByRole('button', { name: 'Revenir à l’année', exact: true }).click();
  await page.getByRole('button', { name: 'Ouvrir février 2027', exact: true }).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Ouvrir février 2027', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'février 2027', exact: true })).toBeVisible();
  const february = scroll.locator('.calendar-month[aria-label="février 2027"]');
  await expect(february.locator('.month-cell')).toHaveCount(28);
  await expect(february.locator('.month-blank')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Nouvel événement', exact: true }).click();
  await expect(page.getByLabel('Date de début', { exact: true })).toHaveValue('2027-02-01');
});


test('navigates through year, month and day, updates the week strip and avoids mobile hover backgrounds', async ({ page }, testInfo) => {
  await page.locator('[data-date="2026-11-10"] .day-number').click();
  const week = page.getByRole('navigation', { name: 'Semaine du jour sélectionné', exact: true });
  await expect(week.getByRole('button')).toHaveCount(7);
  await expect(week.locator('.day-week-number')).toHaveText(['9', '10', '11', '12', '13', '14', '15']);
  await week.getByRole('button', { name: 'Afficher dimanche 15 novembre', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'dimanche 15 novembre', exact: true })).toBeVisible();
  await expect(week.getByRole('button', { name: 'Afficher dimanche 15 novembre', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Jour suivant', exact: true }).click();
  await expect(week.locator('.day-week-number')).toHaveText(['16', '17', '18', '19', '20', '21', '22']);
  await expect(page.getByRole('heading', { name: 'lundi 16 novembre', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('day-week-strip.png') });

  await page.getByRole('button', { name: 'Revenir aux mois', exact: true }).click();
  const sixteenth = page.locator('[data-date="2026-11-16"] .day-number');
  await sixteenth.scrollIntoViewIfNeeded();
  await sixteenth.hover();
  await expect(sixteenth).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(sixteenth).not.toHaveAttribute('aria-pressed');
  const calendars = page.getByRole('button', { name: 'Calendriers', exact: true });
  await calendars.hover();
  await expect(calendars).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

  await page.getByRole('button', { name: 'Revenir à l’année', exact: true }).click();
  await expect(page.getByRole('heading', { name: '2026', exact: true })).toBeVisible();
  await expect(page.locator('.calendar-year[data-year="2026"] .year-month')).toHaveCount(12);
  await expect(page.locator('.event-chip, .timed-event')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('year.png') });
  await page.getByRole('button', { name: 'Ouvrir décembre 2026', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'décembre 2026', exact: true })).toBeVisible();
  await expect.poll(() => page.locator('.calendar-month[aria-label="décembre 2026"]').evaluate(el => Math.abs(el.getBoundingClientRect().top - el.parentElement!.getBoundingClientRect().top))).toBeLessThan(2);

  const display = page.getByRole('button', { name: 'Choisir l’affichage', exact: true });
  await display.click();
  await expect(page.getByRole('menuitemradio')).toHaveCount(2);
  await expect(page.getByRole('menuitemradio', { name: 'Calendrier', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.screenshot({ path: testInfo.outputPath('display-menu.png') });
  await page.getByRole('menuitemradio', { name: 'Liste', exact: true }).click();
  await expect(page.locator('.agenda-view')).toBeVisible();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await display.click();
  await page.getByRole('menuitemradio', { name: 'Calendrier', exact: true }).click();
  await expect(page.locator('.month-calendar')).toBeVisible();
  await display.click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(display).toBeFocused();
  await display.click();
  await page.getByRole('heading', { name: 'décembre 2026', exact: true }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});


for (const layout of ['mobile', 'desktop'] as const) {
  test(`scrolls years continuously in both directions and selects a month on ${layout}`, async ({ page }, testInfo) => {
    if (layout === 'desktop') await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: 'Revenir à l’année', exact: true }).click();
    const scroll = page.getByLabel('Années défilantes', { exact: true });
    await expect(page.getByRole('button', { name: /Année précédente|Année suivante/ })).toHaveCount(0);
    await expect(scroll.locator('.year-weekday')).toHaveCount(0);
    await expect(scroll.locator('.event-chip, .timed-event')).toHaveCount(0);
    await expect(scroll.locator('[data-year="2026"] .year-month')).toHaveCount(12);
    await expect.poll(() => scroll.locator('[data-year="2026"]').evaluate(el => Math.abs(el.getBoundingClientRect().top - el.parentElement!.getBoundingClientRect().top))).toBeLessThan(2);
    await page.screenshot({ path: testInfo.outputPath('years.png') });

    if (layout === 'mobile') {
      const before = await scroll.evaluate(el => el.scrollTop);
      await swipe(page, { x: 200, y: 610 }, { x: 204, y: 270 });
      await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBeGreaterThan(before + 100);
      await expect(scroll).toBeVisible();
      // Let touch inertia end before measuring deliberate window-boundary jumps.
      await scroll.evaluate(el => new Promise<void>(resolve => {
        let previous = el.scrollTop;
        let stableFrames = 0;
        const settled = () => {
          const current = el.scrollTop;
          stableFrames = current === previous ? stableFrames + 1 : 0;
          previous = current;
          if (stableFrames >= 8) resolve();
          else requestAnimationFrame(settled);
        };
        requestAnimationFrame(settled);
      }));
    }

    const initialFirst = Number(await scroll.locator('.calendar-year').first().getAttribute('data-year'));
    for (const direction of [1, 1, 1, 1, -1, -1, -1, -1, -1]) {
      const before = await scroll.evaluate((el, direction) => {
        el.scrollTop = direction > 0 ? el.scrollHeight - el.clientHeight - 3 : 2;
        const top = el.getBoundingClientRect().top;
        const anchor = [...el.querySelectorAll<HTMLElement>('[data-year]')].find(node => node.getBoundingClientRect().bottom > top + 1)!;
        return { first: Number(el.firstElementChild?.getAttribute('data-year')), anchor: anchor.dataset.year!, offset: anchor.getBoundingClientRect().top - top };
      }, direction);
      await expect.poll(async () => Number(await scroll.locator('.calendar-year').first().getAttribute('data-year'))).toBe(before.first + direction * 2);
      await expect(scroll.locator('.calendar-year')).toHaveCount(7);
      const offset = await scroll.locator(`[data-year="${before.anchor}"]`).evaluate(el => el.getBoundingClientRect().top - el.parentElement!.getBoundingClientRect().top);
      expect(Math.abs(offset - before.offset)).toBeLessThan(2);
    }
    expect(Number(await scroll.locator('.calendar-year').first().getAttribute('data-year'))).toBe(initialFirst - 2);

    // Reset after a long journey, and also when already in the current year.
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.getByRole('button', { name: 'Aujourd’hui', exact: true }).click();
      await expect.poll(() => scroll.locator('[data-year="2026"]').evaluate(el => Math.abs(el.getBoundingClientRect().top - el.parentElement!.getBoundingClientRect().top))).toBeLessThan(2);
      if (attempt === 0) await scroll.evaluate(el => { el.scrollTop += 150; });
    }

    const february = page.getByRole('button', { name: 'Ouvrir février 2028', exact: true });
    await february.scrollIntoViewIfNeeded();
    await expect(february.locator('.year-date').filter({ hasText: /^29$/ })).toHaveCount(1);
    await february.click();
    await expect(page.getByRole('heading', { name: 'février 2028', exact: true })).toBeVisible();
    await expect(page.locator('.calendar-month[aria-label="février 2028"] .month-cell')).toHaveCount(29);
    await page.getByRole('button', { name: 'Revenir à l’année', exact: true }).click();
    await expect.poll(() => scroll.locator('[data-year="2028"]').evaluate(el => Math.abs(el.getBoundingClientRect().top - el.parentElement!.getBoundingClientRect().top))).toBeLessThan(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
