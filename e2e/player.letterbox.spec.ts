import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page } from '@playwright/test';
import { fluxHtmlOf } from './pages/flux-html.js';
import { expect, test } from './test.js';

// FR-PRS-001: a screen is shown whole, scaled to fit the window, with the bars an aspect mismatch leaves equal on both sides. The deck is the one a `.flux.html`
// runs (the built one-file player), opened from file://.
test.describe('letterboxing in the player', { tag: '@desktop' }, () => {
  let dir = '';
  let url = '';
  test.beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'fluxion-letterbox-'));
    const file = join(dir, 'deck.flux.html');
    writeFileSync(file, await fluxHtmlOf('two-rects-line', { title: 'Letterbox' }), 'utf8');
    url = pathToFileURL(file).href;
  });
  test.afterAll(() => rmSync(dir, { recursive: true, force: true }));

  /** The bars around the screen: the gap to the deck's edge on each side, in pixels. */
  async function bars(page: Page): Promise<{ top: number; bottom: number; left: number; right: number; width: number; height: number }> {
    const deck = await page.getByTestId('player-deck').boundingBox();
    const screen = await page.locator('.fx-screen').first().boundingBox();
    if (deck === null || screen === null) throw new Error('the deck or the screen is not on the page');
    return {
      top: screen.y - deck.y,
      bottom: deck.y + deck.height - (screen.y + screen.height),
      left: screen.x - deck.x,
      right: deck.x + deck.width - (screen.x + screen.width),
      width: screen.width,
      height: screen.height,
    };
  }

  test('FR-PRS-001: a 16:9 screen in a 16:10 window has equal bars above and below and none at the sides', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(url);
    await page.locator('.fx-screen').first().waitFor();
    const b = await bars(page);
    // 1600 wide gives 900 high: 50 px above and below
    expect(Math.abs(b.top - b.bottom)).toBeLessThanOrEqual(1);
    expect(b.top).toBeGreaterThan(40);
    expect(Math.abs(b.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.right)).toBeLessThanOrEqual(1);
    expect(b.width / b.height).toBeCloseTo(16 / 9, 2);
  });

  test('FR-PRS-001: in a window wider than the screen the bars are at the sides, equal, and the whole screen is shown', async ({ page }) => {
    await page.setViewportSize({ width: 2000, height: 800 });
    await page.goto(url);
    await page.locator('.fx-screen').first().waitFor();
    const b = await bars(page);
    expect(Math.abs(b.left - b.right)).toBeLessThanOrEqual(1);
    expect(b.left).toBeGreaterThan(100);
    expect(Math.abs(b.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.bottom)).toBeLessThanOrEqual(1);
  });

  test('FR-PRS-001: a resize keeps the screen fitted with equal bars', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(url);
    await page.locator('.fx-screen').first().waitFor();
    await page.setViewportSize({ width: 900, height: 1400 });
    await expect.poll(async () => Math.round((await bars(page)).width)).toBeLessThanOrEqual(900);
    const b = await bars(page);
    expect(Math.abs(b.top - b.bottom)).toBeLessThanOrEqual(1);
    expect(b.top).toBeGreaterThan(100);
    expect(Math.abs(b.left)).toBeLessThanOrEqual(1);
  });
});
