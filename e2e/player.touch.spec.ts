import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Locator, Page } from '@playwright/test';
import { fluxHtmlOf } from './pages/flux-html.js';
import { expect, test } from './test.js';

// FR-RSP-001: the one-file player on the phone projects (mobile-chrome, mobile-safari). A tap steps forward through the real touchscreen; the swipe and the pinch
// are pointer events of type touch on the stage, because Playwright has no multi-touch on WebKit and the deck reads pointer events alone.
test.describe('touch on the player', () => {
  let dir = '';
  let url = '';
  test.beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'fluxion-touch-'));
    const file = join(dir, 'deck.flux.html');
    writeFileSync(file, await fluxHtmlOf('doc20', { title: 'Touch' }), 'utf8');
    url = pathToFileURL(file).href;
  });
  test.afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const stage = (page: Page) => page.getByTestId('player-deck');
  const counter = (page: Page) => page.getByTestId('deck-counter');
  async function open(page: Page): Promise<void> {
    await page.goto(url);
    await page.locator('.fx-screen').first().waitFor();
  }
  async function finger(target: Locator, type: 'pointerdown' | 'pointermove' | 'pointerup', id: number, at: { x: number; y: number }): Promise<void> {
    await target.dispatchEvent(type, {
      pointerType: 'touch',
      pointerId: id,
      clientX: at.x,
      clientY: at.y,
      isPrimary: id === 1,
      bubbles: true,
      cancelable: true,
    });
  }
  async function swipe(page: Page, from: number, to: number): Promise<void> {
    const y = (page.viewportSize()?.height ?? 600) / 2;
    const target = stage(page);
    await finger(target, 'pointerdown', 1, { x: from, y: y });
    await finger(target, 'pointermove', 1, { x: (from + to) / 2, y: y });
    await finger(target, 'pointermove', 1, { x: to, y: y });
    await finger(target, 'pointerup', 1, { x: to, y: y });
  }

  test('FR-RSP-001: a swipe left goes to the next screen and a swipe right back; a tap advances', async ({ page }) => {
    await open(page);
    const width = page.viewportSize()?.width ?? 400;
    await expect(counter(page)).toHaveText('1 / 20');
    await swipe(page, width * 0.8, width * 0.2);
    await expect(counter(page)).toHaveText('2 / 20');
    await swipe(page, width * 0.2, width * 0.8);
    await expect(counter(page)).toHaveText('1 / 20');
    await page.touchscreen.tap(width / 2, (page.viewportSize()?.height ?? 600) / 2);
    await expect(counter(page)).toHaveText('2 / 20');
  });

  test('FR-RSP-001: a pinch zooms into the screen within bounds, a drag pans it, and a double tap fits it', async ({ page }) => {
    await open(page);
    const { width, height } = page.viewportSize() ?? { width: 400, height: 800 };
    const target = stage(page);
    const cx = width / 2;
    const cy = height / 2;
    await finger(target, 'pointerdown', 1, { x: cx - 30, y: cy });
    await finger(target, 'pointerdown', 2, { x: cx + 30, y: cy });
    await finger(target, 'pointermove', 2, { x: cx + 60, y: cy });
    await finger(target, 'pointermove', 1, { x: cx - 60, y: cy });
    await expect(target).toHaveAttribute('data-zoom', '2');
    // spread far past the bound: the zoom stops at 4
    await finger(target, 'pointermove', 2, { x: cx + 3000, y: cy });
    await finger(target, 'pointermove', 1, { x: cx - 3000, y: cy });
    await expect(target).toHaveAttribute('data-zoom', '4');
    await finger(target, 'pointerup', 1, { x: cx - 3000, y: cy });
    await finger(target, 'pointerup', 2, { x: cx + 3000, y: cy });
    // the screen still covers the stage: its transform never leaves the bounds
    const matrix = await page.getByTestId('deck-view').evaluate((el) => {
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      return { scale: m.a, x: m.e, y: m.f, w: el.clientWidth, h: el.clientHeight };
    });
    expect(matrix.scale).toBe(4);
    expect(matrix.x).toBeLessThanOrEqual(0);
    expect(matrix.x).toBeGreaterThanOrEqual(matrix.w * (1 - 4));
    expect(matrix.y).toBeGreaterThanOrEqual(matrix.h * (1 - 4));
    // zoomed in, a swipe pans and does not move the deck
    await swipe(page, width * 0.8, width * 0.2);
    await expect(counter(page)).toHaveText('1 / 20');
    // a double tap fits the screen again
    for (let i = 0; i < 2; i++) {
      await finger(target, 'pointerdown', 1, { x: cx, y: cy });
      await finger(target, 'pointerup', 1, { x: cx, y: cy });
    }
    await expect(target).toHaveAttribute('data-zoom', '1');
  });
});
