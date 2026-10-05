import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { fluxFileOf } from './pages/flux-files.js';
import { expect, test } from './test.js';

// FR-PRS-009: `<fluxion-player>` in a plain page. The page is `examples/embed/index.html` as the repository holds it, served at a made-up URL together with the built
// element script and a deck (the 20-screen fixture), so the example is what is tested: the page includes the script, the element loads `deck.flux`, and the page's
// own buttons drive `goTo`, `next` and `prev` and read `fluxion-position`.
const PAGE = readFileSync(resolve('examples/embed/index.html'), 'utf8');
const SCRIPT = (): Buffer => readFileSync(resolve('packages/player-inline/dist/fluxion-player.js'));

test.describe('the element in a plain page', { tag: '@desktop' }, () => {
  let deck: Uint8Array;
  test.beforeAll(async () => {
    deck = await fluxFileOf('doc20');
  });

  async function open(page: Page): Promise<void> {
    await page.route('**/embed-example/**', (route) => {
      const url = route.request().url();
      if (url.endsWith('/index.html')) return route.fulfill({ contentType: 'text/html', body: PAGE });
      if (url.endsWith('/fluxion-player.js')) return route.fulfill({ contentType: 'text/javascript', body: SCRIPT() });
      if (url.endsWith('/deck.flux')) return route.fulfill({ contentType: 'application/octet-stream', body: Buffer.from(deck) });
      return route.fulfill({ status: 404, body: '' });
    });
    // the example names the script by its place in the repository: serve it under the same name wherever it is asked for
    await page.route('**/packages/player-inline/dist/fluxion-player.js', (route) => route.fulfill({ contentType: 'text/javascript', body: SCRIPT() }));
    await page.goto('/embed-example/index.html');
    await expect(page.locator('#where')).toHaveText('screen 1 of 20');
  }

  test('FR-PRS-009: the element loads its src and reports where it is; the page drives goTo, next and prev and receives fluxion-position', async ({ page }) => {
    await open(page);
    const player = page.locator('fluxion-player');
    await page.locator('#third').click();
    await expect(page.locator('#where')).toHaveText('screen 3 of 20');
    await page.locator('#next').click();
    await expect(page.locator('#where')).toHaveText('screen 4 of 20');
    await page.locator('#prev').click();
    await expect(page.locator('#where')).toHaveText('screen 3 of 20');
    // the position is also on the element for a script that asks
    expect(await player.evaluate((el) => (el as unknown as { position: { index: number; count: number } }).position)).toMatchObject({ index: 2, count: 20 });
    // it draws in a shadow root and leaves the page's head alone
    expect(await player.evaluate((el) => el.shadowRoot?.querySelector('.fx-screen') !== null)).toBe(true);
    expect(await page.evaluate(() => document.querySelector('style[data-fx-content]') === null)).toBe(true);
  });

  test("FR-PRS-009: its keys are its own: the page's keys do nothing to it, and once it has focus the arrows move it", async ({ page }) => {
    await open(page);
    await page.mouse.click(5, 5);
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#where')).toHaveText('screen 1 of 20');
    // focus the element's stage (a click on it would also step forward)
    await page.locator('fluxion-player [data-testid="player-deck"]').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#where')).toHaveText('screen 2 of 20');
    await page.keyboard.press('End');
    await expect(page.locator('#where')).toHaveText('screen 20 of 20');
  });

  test('FR-PRS-009: a deck that cannot be fetched is a fluxion-error event the page can show', async ({ page }) => {
    await page.route('**/embed-example/**', (route) => {
      const url = route.request().url();
      if (url.endsWith('/index.html')) return route.fulfill({ contentType: 'text/html', body: PAGE });
      return route.fulfill({ status: 404, body: '' });
    });
    await page.route('**/packages/player-inline/dist/fluxion-player.js', (route) => route.fulfill({ contentType: 'text/javascript', body: SCRIPT() }));
    await page.goto('/embed-example/index.html');
    await expect(page.locator('#where')).toContainText('404');
  });
});
