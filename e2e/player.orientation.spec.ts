import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fluxHtmlOf } from './pages/flux-html.js';
import { expect, test } from './test.js';

// FR-RSP-007: a rotation or a resize is no reload: the same document, the screen and the build group stay, and the screen is fitted into the new size.
test.describe('orientation and resize of the player', () => {
  let dir = '';
  let url = '';
  test.beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'fluxion-orient-'));
    const file = join(dir, 'deck.flux.html');
    writeFileSync(file, await fluxHtmlOf('doc20', { title: 'Orientation' }), 'utf8');
    url = pathToFileURL(file).href;
  });
  test.afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test('FR-RSP-007: rotating the device keeps the screen and group, redraws the screen fitted, and does not reload the page', async ({ page }) => {
    await page.goto(url);
    await page.locator('.fx-screen').first().waitFor();
    await page.evaluate(() => {
      (window as unknown as { __kept: boolean }).__kept = true;
    });
    const stage = page.getByTestId('player-deck');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('deck-counter')).toHaveText('4 / 20');
    const group = await stage.getAttribute('data-group');
    const fitted = () =>
      page
        .locator('.fx-screen')
        .first()
        .evaluate((el) => {
          const r = el.getBoundingClientRect();
          return { w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight };
        });
    const before = await fitted();
    const size = page.viewportSize() ?? { width: 400, height: 800 };
    await page.setViewportSize({ width: size.height, height: size.width });
    await expect.poll(async () => (await fitted()).vw).toBe(size.height);
    const after = await fitted();
    // the screen is the same one at another size, within the new window
    await expect(page.getByTestId('deck-counter')).toHaveText('4 / 20');
    expect(await stage.getAttribute('data-group')).toBe(group);
    expect(after.w).toBeLessThanOrEqual(after.vw);
    expect(after.h).toBeLessThanOrEqual(after.vh);
    expect(after.w / after.h).toBeCloseTo(before.w / before.h, 1);
    expect(after.w !== before.w || after.h !== before.h).toBe(true);
    expect(await page.evaluate(() => (window as unknown as { __kept?: boolean }).__kept)).toBe(true);
  });
});
