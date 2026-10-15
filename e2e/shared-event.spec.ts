/**
 * SR-03: two people, two browsers, two time zones, one shared backend.
 * Nadia (Vancouver) creates and shares an event; Sam (London) joins from the link and paints;
 * Nadia's page updates live, she locks a time, and Sam sees "It's on." without reloading.
 *
 * Needs a build with VITE_DATA_BACKEND=supabase pointing at a running Supabase (local or remote).
 */
import { test, expect, type Page, type Browser } from '@playwright/test';

async function person(browser: Browser, timezoneId: string): Promise<Page> {
  const context = await browser.newContext({ timezoneId, locale: 'en-US' });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`[${timezoneId}] page error:`, e.message));
  return page;
}

/** Drag across the paint grid from one cell to another. */
async function paint(page: Page, r0: number, c0: number, r1: number, c1: number) {
  const a = await page.locator(`.paint [data-r="${r0}"][data-c="${c0}"]`).boundingBox();
  const b = await page.locator(`.paint [data-r="${r1}"][data-c="${c1}"]`).boundingBox();
  if (!a || !b) throw new Error('grid cell not found');
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
  await page.mouse.up();
}

test('create, share, join, live update, lock in: across two browsers and time zones', async ({ browser }) => {
  const nadia = await person(browser, 'America/Vancouver');
  const sam = await person(browser, 'Europe/London');

  // Nadia creates the event, step by step.
  await nadia.goto('/new');
  await nadia.locator('#title').fill('Family call');
  await nadia.getByRole('button', { name: 'Next →' }).click();
  await nadia.getByRole('button', { name: 'The next 7 days' }).click();
  await nadia.getByRole('button', { name: 'Next →' }).click();
  await nadia.getByRole('radio', { name: /Any time of day/ }).click();
  await nadia.getByRole('button', { name: 'Next →' }).click();
  await nadia.getByRole('button', { name: 'Next →' }).click();
  await nadia.getByPlaceholder('Nadia').fill('Nadia');
  await nadia.getByRole('button', { name: /Create event/ }).click();
  await expect(nadia).toHaveURL(/\/e\/[1-9A-HJ-NP-Za-km-z]{14}/);

  // The share sheet: a real, shareable link (no local-mode warning).
  await expect(nadia.getByRole('heading', { name: 'It’s live.' })).toBeVisible();
  await expect(nadia.getByTestId('local-share-note')).toHaveCount(0);
  const eventUrl = nadia.url().split('?')[0].split('#')[0];

  // Nadia paints tomorrow, 8:00 am to 1:30 pm Vancouver time, and saves.
  await nadia.getByRole('button', { name: /Add my times/ }).click();
  await paint(nadia, 0, 1, 10, 1);
  await expect(nadia.getByText('Saved', { exact: true })).toBeVisible();
  await nadia.getByRole('button', { name: /^Done/ }).click();
  await expect(nadia.getByText(/1 person · 1 time zone/)).toBeVisible();

  // Sam opens the link in London, in a separate browser.
  await sam.goto(eventUrl);
  await expect(sam.getByText(/Nadia invited you to/)).toBeVisible();
  await sam.getByRole('button', { name: 'Add your times' }).first().click();
  await sam.getByPlaceholder('Sam').fill('Sam');
  await sam.getByRole('button', { name: /paint your times/ }).click();
  // Sam's grid is in London time: Vancouver 8:00 am is 4:00 pm in London.
  await expect(sam.locator('.paint .tgrid-time').first()).toContainText('4:00 pm');
  await paint(sam, 0, 0, 10, 6);
  await expect(sam.getByText('Saved', { exact: true })).toBeVisible();
  await sam.getByRole('button', { name: /^Done/ }).click();

  // Nadia's page updates live: no reload.
  await expect(nadia.getByText(/2 people · 2 time zones/)).toBeVisible({ timeout: 15_000 });
  await expect(nadia.getByRole('button', { name: 'Lock it in' }).first()).toBeVisible();

  // Nadia locks the best time. Both see "It's on." Sam's without reloading.
  await nadia.getByRole('button', { name: 'Lock it in' }).first().click();
  await expect(nadia.getByRole('dialog').getByRole('heading', { name: 'It’s on.' })).toBeVisible();
  await expect(sam.getByRole('dialog').getByRole('heading', { name: 'It’s on.' })).toBeVisible({ timeout: 15_000 });
  await expect(sam.getByRole('dialog')).toContainText('London');
  await expect(nadia.getByRole('dialog')).toContainText('Vancouver');

  // And the locked time is 8 hours later for Sam than for Nadia's 8:00 am-ish slot.
  const nadiaTime = await nadia.locator('.moment .big-time').innerText();
  const samTime = await sam.locator('.moment .big-time').innerText();
  const toMinutes = (t: string) => {
    const m = /(\d+):(\d+)\s*(am|pm)/i.exec(t)!;
    return ((Number(m[1]) % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0)) * 60 + Number(m[2]);
  };
  expect((toMinutes(samTime) - toMinutes(nadiaTime) + 1440) % 1440).toBe(8 * 60);
});
