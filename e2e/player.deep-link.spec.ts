import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page } from '@playwright/test';
import { fluxHtmlOf } from './pages/flux-html.js';
import { expect, test } from './test.js';

// FR-PRS-005: the position of a presentation is in the URL's hash, `#/<screen id>/<group>`: a reload or a shared link opens at it, a new screen is a history
// entry that the browser's back button undoes, and a link naming no screen opens the first. The deck is the one a `.flux.html` runs, opened from file://.
test.describe('deep links in the player', { tag: '@desktop' }, () => {
  let dir = '';
  let url = '';
  test.beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'fluxion-links-'));
    const file = join(dir, 'deck.flux.html');
    writeFileSync(file, await fluxHtmlOf('doc20', { title: 'Links' }), 'utf8');
    url = pathToFileURL(file).href;
  });
  test.afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const deck = (page: Page) => page.getByTestId('player-deck');
  const shownId = (page: Page) => page.locator('.fx-screen').first().getAttribute('data-screen-id');
  async function open(page: Page, hash = ''): Promise<void> {
    // a fresh load: a change of hash alone on the open page is a move within it
    await page.goto('about:blank');
    await page.goto(url + hash);
    await page.locator('.fx-screen').first().waitFor();
  }

  test('FR-PRS-005: moving writes the position into the hash, and a reload restores it', async ({ page }) => {
    await open(page);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(deck(page)).toHaveAttribute('data-screen-index', '2');
    const third = await shownId(page);
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#/${third}/0`);
    await page.reload();
    await page.locator('.fx-screen').first().waitFor();
    await expect(deck(page)).toHaveAttribute('data-screen-index', '2');
    expect(await shownId(page)).toBe(third);
  });

  test('FR-PRS-005: a link opens at its screen, and browser back returns to the previous screen and forward to the next', async ({ page }) => {
    await open(page);
    const first = await shownId(page);
    await page.keyboard.press('ArrowRight');
    await expect(deck(page)).toHaveAttribute('data-screen-index', '1');
    const second = await shownId(page);
    await page.keyboard.press('ArrowRight');
    await expect(deck(page)).toHaveAttribute('data-screen-index', '2');
    await page.goBack();
    await expect(deck(page)).toHaveAttribute('data-screen-index', '1');
    expect(await shownId(page)).toBe(second);
    await page.goBack();
    await expect(deck(page)).toHaveAttribute('data-screen-index', '0');
    expect(await shownId(page)).toBe(first);
    await page.goForward();
    await expect(deck(page)).toHaveAttribute('data-screen-index', '1');
  });

  test('FR-PRS-005: a shared link opens at its screen, and one naming no screen opens the first', async ({ page }) => {
    await open(page);
    await page.keyboard.press('End');
    const last = await shownId(page);
    await open(page, `#/${last}/0`);
    await expect(deck(page)).toHaveAttribute('data-screen-index', '19');
    await open(page, '#/no-such-screen/4');
    await expect(deck(page)).toHaveAttribute('data-screen-index', '0');
  });
});
