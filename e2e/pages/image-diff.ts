import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

// The image comparison of the pixel-parity specs (edit against present, the studio against a .flux.html): the share of pixels that differ, with
// the anti-aliasing exemption pixelmatch (Playwright's comparator) makes, so a fill or a hard edge is never excused.

/** The bounds from thresholds.mjs (read as text: the spec does not import the gate's module). */
const THRESHOLDS = readFileSync(new URL('../../scripts/gates/thresholds.mjs', import.meta.url), 'utf8');
const bound = (key: string) => Number(new RegExp(`${key}: \\{ value: ([\\d.]+)`).exec(THRESHOLDS)?.[1]);
export const PARITY_MAX_DIFF_PCT = bound('PARITY_MAX_DIFF_PCT');
export const PARITY_CHANNEL_DELTA = bound('PARITY_CHANNEL_DELTA');
export const PARITY_EDGE_DELTA = bound('PARITY_EDGE_DELTA');

/**
 * The share of pixels, in percent, that differ between two same-sized images. A pixel differs when
 * a channel is off by more than PARITY_CHANNEL_DELTA, unless it is anti-aliasing in either image as
 * pixelmatch (Playwright's comparator) judges it: a pixel between a darker and a brighter neighbour,
 * at most two neighbours like it, whose darkest or brightest neighbour is part of a flat area in both
 * images, and those neighbours more than PARITY_EDGE_DELTA apart in brightness. A pixel of a fill or
 * of a hard edge is never excused, so a uniform tint and a 1 px shift both count (M6 final F1).
 */
export function diffPct(x: Pixels, y: Pixels): number {
  if (x.w !== y.w || x.h !== y.h) return 100;
  let differ = 0;
  for (let p = 0; p < x.w * x.h; p++) {
    if (apart(x.data, y.data, p * 4, p * 4) > PARITY_CHANNEL_DELTA && !antialiased(x, p, y) && !antialiased(y, p, x)) differ++;
  }
  return (differ / (x.w * x.h)) * 100;
}

export type Pixels = { readonly w: number; readonly h: number; readonly data: Uint8Array };

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

/** A PNG decoded by the browser into RGBA pixels. */
export async function pixels(page: Page, png: Buffer): Promise<Pixels> {
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
