import type { Page } from '@playwright/test';
import { EditorPage } from './pages/editor.js';
import { diffPct, PARITY_CHANNEL_DELTA, PARITY_EDGE_DELTA, PARITY_MAX_DIFF_PCT, type Pixels, pixels } from './pages/image-diff.js';
import { expect, test } from './test.js';

// Edit/present parity (FR-EDT-010, 04 §2.4): each example's screen, in edit with an empty selection
// and the overlay unmounted and in present, draws the same content DOM (after the allowlist) and
// the same pixels within PARITY_MAX_DIFF_PCT. Both are taken at scale 1 and whole-pixel offsets: in
// edit, focus mode at 100 % in a 2200 × 1400 window centres the 1920 × 1080 screen 140 px in; present
// in place fits it exactly into a 1920 × 1080 window.

/** The examples the studio opens: their first screens are the fixture screens edit and present show. */
const EXAMPLES = ['shapes-gallery', 'r0-static'];

/**
 * The content layer's markup with the allowlist applied: ids React generates per mount (fills,
 * markers, effects) renumbered by first appearance, everywhere they are referenced.
 */
async function contentDom(page: Page): Promise<string> {
  return page
    .locator('.fx-screen .fx-content')
    .first()
    .evaluate((el) => {
      let html = el.outerHTML;
      const ids = [...new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1] as string))];
      ids.forEach((id, i) => {
        html = html.split(id).join(`ID${i}`);
      });
      return html;
    });
}

/** `img` with its channels scaled by `k` (a uniform darkening). */
const darkened = (img: Pixels, k: number): Pixels => ({ ...img, data: img.data.map((v, i) => (i % 4 === 3 ? v : Math.round(v * k))) });

/** `img` moved `dx`, `dy` px, the edge it leaves repeated. */
function shifted(img: Pixels, dx: number, dy: number): Pixels {
  const data = new Uint8Array(img.data.length);
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      const from = (Math.min(Math.max(y - dy, 0), img.h - 1) * img.w + Math.min(Math.max(x - dx, 0), img.w - 1)) * 4;
      data.set(img.data.subarray(from, from + 4), (y * img.w + x) * 4);
    }
  return { ...img, data };
}

/** How many screens the example `name` has (the navigator lists them). */
async function screenCount(page: Page, name: string): Promise<number> {
  const editor = new EditorPage(page);
  await editor.open(`example-${name}`);
  const focus = editor.toolbarButton('Focus mode');
  if ((await focus.getAttribute('aria-pressed')) === 'true') await focus.click();
  return editor.panel('Screens, library and layers').locator('.fx-chrome-screen').count();
}

/** The `index`th screen of example `name` in edit at scale 1 with nothing selected or hovered, then presented in place (shift+F5 for a later one). */
async function bothModes(page: Page, name: string, index = 0) {
  await page.setViewportSize({ width: 2200, height: 1400 });
  const editor = new EditorPage(page);
  await editor.open(`example-${name}`);
  // focus mode persists: leave it to pick the screen in the navigator, then set it, so the canvas has the window below the toolbar
  const focus = editor.toolbarButton('Focus mode');
  if ((await focus.getAttribute('aria-pressed')) === 'true') await focus.click();
  if (index > 0) await editor.panel('Screens, library and layers').locator('.fx-chrome-screen-button').nth(index).click();
  await focus.click();
  await expect.poll(async () => (await editor.canvas.boundingBox())?.width).toBe(2200);
  // fit the resized canvas, then 100 % about its centre
  await page.keyboard.press('Shift+Digit1');
  await page.keyboard.press('Shift+Digit0');
  await expect(editor.zoomValue).toHaveText('100 %');
  // the pointer is off the canvas, nothing is selected: the overlay is not mounted
  await page.mouse.move(0, 0);
  await expect(page.locator('svg.fx-chrome-overlay')).toHaveCount(0);
  const screen = editor.screens.first();
  // centred at whole pixels: 140 px in from the canvas (0, 40) each way
  expect(await screen.boundingBox()).toEqual({ x: 140, y: 180, width: 1920, height: 1080 });
  const edit = { dom: await contentDom(page), png: await screen.screenshot({ animations: 'disabled' }) };
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.keyboard.press(index === 0 ? 'F5' : 'Shift+F5');
  await expect(page.getByTestId('editor-root')).toHaveAttribute('data-mode', 'present');
  const presented = page.getByTestId('present-in-place').locator('.fx-screen');
  await expect(presented).toHaveCount(1);
  const present = { dom: await contentDom(page), png: await presented.screenshot({ animations: 'disabled' }) };
  return { edit, present };
}

// window sizes and the keyboard: desktop
test.describe('edit and present parity', { tag: '@desktop' }, () => {
  test('FR-EDT-010: with an empty selection and the overlay unmounted, each fixture screen draws the same pixels in edit and present', async ({ page }) => {
    expect([PARITY_MAX_DIFF_PCT, PARITY_CHANNEL_DELTA, PARITY_EDGE_DELTA]).toEqual([0.1, 8, 64]);
    for (const name of EXAMPLES) {
      const { edit, present } = await bothModes(page, name);
      const [e, p] = [await pixels(page, edit.png), await pixels(page, present.png)];
      const pct = diffPct(e, p);
      expect(pct, `${name}: ${pct.toFixed(4)} % of the pixels differ`).toBeLessThanOrEqual(PARITY_MAX_DIFF_PCT);
      // the comparison sees what it must not excuse: the screen 10 % darker (far over the bound), or
      // moved by 1 px (over it)
      expect(diffPct(e, darkened(e, 0.9)), `${name}, darker`).toBeGreaterThan(10 * PARITY_MAX_DIFF_PCT);
      expect(diffPct(e, shifted(e, 1, 0)), `${name}, 1 px right`).toBeGreaterThan(PARITY_MAX_DIFF_PCT);
      expect(diffPct(e, shifted(e, 0, 1)), `${name}, 1 px down`).toBeGreaterThan(PARITY_MAX_DIFF_PCT);
    }
  });

  test('FR-EDT-010: every screen of every example draws the same pixels in edit and present', async ({ page }) => {
    let screens = 0;
    for (const name of [...EXAMPLES, 'rich-text', 'arrange-demo']) {
      const count = await screenCount(page, name);
      for (let index = 0; index < count; index++) {
        const { edit, present } = await bothModes(page, name, index);
        const pct = diffPct(await pixels(page, edit.png), await pixels(page, present.png));
        expect(pct, `${name} screen ${index + 1}: ${pct.toFixed(4)} % of the pixels differ`).toBeLessThanOrEqual(PARITY_MAX_DIFF_PCT);
        expect(present.dom, `${name} screen ${index + 1}`).toBe(edit.dom);
        screens += 1;
      }
    }
    // the gallery's screen, both of r0-static's, the rich-text one and the arrange demo's three (perf-500 is the drag benchmark's)
    expect(screens).toBe(7);
  });

  test('FR-EDT-010: the content layer DOM is equal in edit and present after the allowlist', async ({ page }) => {
    for (const name of EXAMPLES) {
      const { edit, present } = await bothModes(page, name);
      expect(present.dom, name).toBe(edit.dom);
      // the allowlist only renumbers generated ids: the screen's elements are all there
      expect(edit.dom.match(/class="fx-el"/g)?.length ?? 0, name).toBeGreaterThan(5);
    }
  });
  test('FR-TXT-001: the rich-text fixture draws the same pixels in edit and present', async ({ page }) => {
    const { edit, present } = await bothModes(page, 'rich-text');
    const pct = diffPct(await pixels(page, edit.png), await pixels(page, present.png));
    expect(pct, `rich-text: ${pct.toFixed(4)} % of the pixels differ`).toBeLessThanOrEqual(PARITY_MAX_DIFF_PCT);
    // the same content DOM, and the text is drawn: marks and blocks are all there
    expect(present.dom).toBe(edit.dom);
    for (const tag of ['strong', 'em', 'u', 's', 'code', 'mark', 'a', 'h1', 'h2', 'h3', 'ul', 'ol', 'li']) expect(edit.dom, tag).toContain(`<${tag}`);
  });
});
