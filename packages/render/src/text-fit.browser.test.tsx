import { createMetricsMeasurer, readFontMetrics, wrapStyled } from '@fluxion/core';
import type { RichTextDoc } from '@fluxion/schema';
import { LIGHT_THEME } from '@fluxion/theme';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CONTENT_CSS } from './content-css.js';
import { styledBlocks } from './rich-layout.js';
import { RichText } from './rich-text.js';
import { createCanvasMeasurer } from './text-measurer.js';

declare global {
  interface ImportMeta {
    /** Vite's build-time glob import (vitest runs this file through Vite). */
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}

const FILES = import.meta.glob('../../../fixtures/fonts/*.json', { query: '?raw', import: 'default', eager: true });
const json = (name: string): unknown => JSON.parse(FILES[`../../../fixtures/fonts/${name}`] ?? 'null');
const docs = (json('rich-samples.json') as { readonly samples: readonly { readonly name: string; readonly width: number; readonly doc: RichTextDoc }[] })
  .samples;
const recorded = (json('roboto.rendered.json') as { readonly rich: readonly { readonly name: string; readonly height: number }[] }).rich;

const loaded: FontFace[] = [];
let css: HTMLStyleElement;
let host: HTMLElement;
let root: Root;
beforeAll(async () => {
  for (const [file, weight] of [
    ['roboto-400.woff2', '400'],
    ['roboto-700.woff2', '700'],
  ] as const) {
    const face = new FontFace('Roboto', `url(${new URL(`../../../fixtures/fonts/${file}`, import.meta.url).href})`, { weight });
    document.fonts.add(await face.load());
    loaded.push(face);
  }
  await document.fonts.ready;
});
afterAll(() => {
  for (const face of loaded) document.fonts.delete(face);
});
beforeEach(() => {
  // the content CSS the screen carries, in the label the shape view draws
  css = document.createElement('style');
  css.textContent = CONTENT_CSS;
  document.head.append(css);
  host = document.createElement('div');
  host.className = 'fx-label';
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  css.remove();
});

/** The height the real RichText takes in a label of `width`, drawn live. */
async function drawnHeight(doc: RichTextDoc, width: number): Promise<number> {
  host.style.cssText = `position:absolute;left:0;top:0;right:auto;bottom:auto;height:auto;width:${width}px;font:400 16px/1.2 Roboto`;
  await act(async () => root.render(<RichText doc={doc} />));
  return host.getBoundingClientRect().height;
}

describe('a fit measures the text as it is drawn (FR-TXT-002, FR-SHP-006)', () => {
  it('FR-TXT-002: a fit measures marks and blocks as they are drawn', async () => {
    const canvas = createCanvasMeasurer();
    await canvas.ready();
    const measurer = createMetricsMeasurer(readFontMetrics(json('roboto.metrics.json')).faces, canvas);
    const base = { family: 'Roboto', size: 16, lineHeight: 1.2, weight: 400 };
    expect(docs.length).toBeGreaterThanOrEqual(10);
    for (const s of docs) {
      const live = await drawnHeight(s.doc, s.width);
      const laid = wrapStyled(styledBlocks(s.doc, LIGHT_THEME), base, measurer, { maxWidth: s.width, spacing: 'add' });
      expect(Math.abs(laid.height - live), `layout of ${s.name}`).toBeLessThanOrEqual(1);
      // what a browser draws now is what was recorded
      expect(Math.abs(live - (recorded.find((r) => r.name === s.name)?.height ?? Number.NaN)), `record of ${s.name}`).toBeLessThanOrEqual(1);
    }
  });
});
