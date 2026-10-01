import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { EditorPage } from './pages/editor.js';
import { expect, test } from './test.js';

// Edit/present parity (FR-EDT-010, 04 §2.4): each example's screen, in edit with an empty selection
// and the overlay unmounted and in present, draws the same content DOM (after the allowlist) and
// the same pixels within PARITY_MAX_DIFF_PCT. Both are taken at scale 1 and whole-pixel offsets: in
// edit, focus mode at 100 % in a 2200 × 1400 window centres the 1920 × 1080 screen 140 px in; present
// in place fits it exactly into a 1920 × 1080 window.

/** The bounds from thresholds.mjs (read as text: the spec does not import the gate's module). */
const THRESHOLDS = readFileSync(new URL('../scripts/gates/thresholds.mjs', import.meta.url), 'utf8');
const bound = (key: string) => Number(new RegExp(`${key}: \\{ value: ([\\d.]+)`).exec(THRESHOLDS)?.[1]);
const PARITY_MAX_DIFF_PCT = bound('PARITY_MAX_DIFF_PCT');
const PARITY_CHANNEL_DELTA = bound('PARITY_CHANNEL_DELTA');
const PARITY_EDGE_DELTA = bound('PARITY_EDGE_DELTA');

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

/**
 * The share of pixels, in percent, that differ between two same-sized images. A pixel differs when
 * a channel is off by more than PARITY_CHANNEL_DELTA, unless it is anti-aliasing in either image as
 * pixelmatch (Playwright's comparator) judges it: a pixel between a darker and a brighter neighbour,
 * at most two neighbours like it, whose darkest or brightest neighbour is part of a flat area in both
 * images, and those neighbours more than PARITY_EDGE_DELTA apart in brightness. A pixel of a fill or
 * of a hard edge is never excused, so a uniform tint and a 1 px shift both count (M6 final F1).
 */
function diffPct(x: Pixels, y: Pixels): number {
  if (x.w !== y.w || x.h !== y.h) return 100;
  let differ = 0;
  for (let p = 0; p < x.w * x.h; p++) {
    if (apart(x.data, y.data, p * 4, p * 4) > PARITY_CHANNEL_DELTA && !antialiased(x, p, y) && !antialiased(y, p, x)) differ++;
  }
  return (differ / (x.w * x.h)) * 100;
}

type Pixels = { readonly w: number; readonly h: number; readonly data: Uint8Array };

/** How far apart pixels `i` of `d` and `j` of `e` are: their largest channel difference. */
function apart(d: Uint8Array, e: Uint8Array, i: number, j: number): number {
  return Math.max(...[0, 1, 2, 3].map((c) => Math.abs((d[i + c] as number) - (e[j + c] as number))));
}

/** The brightness of pixel `p` of `img` (the YIQ luma pixelmatch compares). */
const luma = (img: Pixels, p: number) =>
  0.29889531 * (img.data[p * 4] as number) + 0.58662247 * (img.data[p * 4 + 1] as number) + 0.11448223 * (img.data[p * 4 + 2] as number);

/** The pixels around `p` in `img` (up to eight, fewer at the border). */
function around(img: Pixels, p: number): number[] {
  const [px, py] = [p % img.w, Math.floor(p / img.w)];
  const out: number[] = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const [nx, ny] = [px + dx, py + dy];
      if ((dx !== 0 || dy !== 0) && nx >= 0 && ny >= 0 && nx < img.w && ny < img.h) out.push(ny * img.w + nx);
    }
  return out;
}

/** How many of `p`'s neighbours in `img` equal it, a border counting as one (pixelmatch). */
function alike(img: Pixels, p: number): number {
  const n = around(img, p);
  return (n.length < 8 ? 1 : 0) + n.filter((q) => apart(img.data, img.data, p * 4, q * 4) === 0).length;
}

/** Whether pixel `p` of `img` is anti-aliasing (pixelmatch's `antialiased`), `other` the image compared. */
function antialiased(img: Pixels, p: number, other: Pixels): boolean {
  if (alike(img, p) > 2) return false;
  const lp = luma(img, p);
  const differing = around(img, p).filter((q) => apart(img.data, img.data, p * 4, q * 4) !== 0);
  const darker = differing.filter((q) => luma(img, q) < lp);
  const brighter = differing.filter((q) => luma(img, q) > lp);
  if (darker.length === 0 || brighter.length === 0) return false;
  const darkest = darker.reduce((a, q) => (luma(img, q) < luma(img, a) ? q : a));
  const brightest = brighter.reduce((a, q) => (luma(img, q) > luma(img, a) ? q : a));
  // an edge: the neighbours span more than PARITY_EDGE_DELTA in brightness (a faint ramp is no edge)
  if (luma(img, brightest) - luma(img, darkest) <= PARITY_EDGE_DELTA) return false;
  const flat = (q: number) => alike(img, q) > 2 && alike(other, q) > 2;
  return flat(darkest) || flat(brightest);
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

/** A PNG decoded by the browser into RGBA pixels. */
async function pixels(page: Page, png: Buffer): Promise<Pixels> {
  const r = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data;
    let raw = '';
    for (let i = 0; i < d.length; i += 0x8000) raw += String.fromCharCode(...d.subarray(i, i + 0x8000));
    return { w: img.width, h: img.height, data: btoa(raw) };
  }, png.toString('base64'));
  return { w: r.w, h: r.h, data: new Uint8Array(Buffer.from(r.data, 'base64')) };
}

/** The example `name` in edit at scale 1 with nothing selected or hovered, then presented in place. */
async function bothModes(page: Page, name: string) {
  await page.setViewportSize({ width: 2200, height: 1400 });
  const editor = new EditorPage(page);
  await editor.open(`example-${name}`);
  // focus mode (it persists: set it only when off), then the canvas has the window below the toolbar
  const focus = editor.toolbarButton('Focus mode');
  if ((await focus.getAttribute('aria-pressed')) !== 'true') await focus.click();
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
  await page.keyboard.press('F5');
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
