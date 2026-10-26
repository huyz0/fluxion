import type { Page } from '@playwright/test';
import { expect } from '../test.js';
import { diffPct, PARITY_MAX_DIFF_PCT, type Pixels, pixels } from './image-diff.js';

export type Capture = readonly [Buffer, Buffer];
export type Clip = { x: number; y: number; width: number; height: number };
const backgrounds = [0, 255] as const;
export async function capturePaint(page: Page, clip: Clip, selector: string, extra = ''): Promise<Capture> {
  const images: Buffer[] = [];
  for (const shade of backgrounds) {
    const style = `html,body{background:rgb(${shade},${shade},${shade})!important} body *:not(${selector}):not(${selector} *):not(:has(${selector})){visibility:hidden!important} body *:has(${selector}){background:transparent!important;box-shadow:none!important;border-color:transparent!important;outline-color:transparent!important} ${selector}{visibility:visible!important}`;
    images.push(await page.screenshot({ clip, animations: 'disabled', style: style + extra }));
  }
  const [black, white] = images;
  if (!black || !white) throw new Error('Incomplete bounded capture');
  return [black, white];
}
export async function decoded(page: Page, capture: Capture): Promise<readonly [Pixels, Pixels]> {
  return [await pixels(page, capture[0]), await pixels(page, capture[1])];
}
/** Foreground deviation bounds, not measured alpha. */
export function occupied(images: readonly [Pixels, Pixels]): readonly number[] | undefined {
  const [black, white] = images;
  let left = black.w;
  let top = black.h;
  let right = -1;
  let bottom = -1;
  for (let p = 0; p < black.w * black.h; p++) {
    const visible = [0, 1, 2].some((channel) => black.data[p * 4 + channel] !== 0 || white.data[p * 4 + channel] !== 255);
    if (!visible) continue;
    const x = p % black.w;
    const y = Math.floor(p / black.w);
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  return right < 0 ? undefined : [left, top, right + 1, bottom + 1];
}
export function expectSamePaint(actual: readonly [Pixels, Pixels], expected: readonly [Pixels, Pixels]): void {
  expect(occupied(actual)).toEqual(occupied(expected));
  for (const index of [0, 1] as const) expect(diffPct(actual[index], expected[index])).toBeLessThanOrEqual(PARITY_MAX_DIFF_PCT);
}
/** Ordered source tree, canonical reference graph, and independently resolved text faces. */
export async function paintStructure(page: Page, selector: string): Promise<unknown> {
  return page.locator(selector).evaluate((root) => {
    const elements = [root, ...root.querySelectorAll('*')];
    const ids = new Map(elements.filter((e) => e.id).map((e, i) => [e.id, `id${i}`]));
    const value = (name: string, v: string) => {
      if (name === 'id') return ids.get(v) ?? v;
      if (name === 'href' || name === 'xlink:href') return `#${ids.get(v.slice(1)) ?? v.slice(1)}`;
      return v.replace(/url\(\s*(['"]?)#([\w.:-]+)\1\s*\)/g, (_all, _quote: string, id: string) => `url(#${ids.get(id) ?? id})`);
    };
    const tree = (element: Element): unknown => {
      const style = getComputedStyle(element);
      return {
        name: element.localName,
        namespace: element.namespaceURI,
        attributes: [...element.attributes]
          .filter((a) => !['xmlns', 'font-family', 'font-weight', 'font-style'].includes(a.name))
          .map((a) => [a.name === 'xlink:href' ? 'href' : a.name, value(a.name, a.value)])
          .sort(([a], [b]) => (a ?? '').localeCompare(b ?? '')),
        text: element.localName === 'text' ? element.textContent : null,
        font: element.localName === 'text' ? [style.fontFamily, style.fontWeight, style.fontStyle] : null,
        children: [...element.children].map(tree),
      };
    };
    return tree(root);
  });
}
