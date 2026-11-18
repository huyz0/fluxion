// The browser build of the SVG export (the studio's) against Node's (ADR-0056 item 7, M20.43): the same fixture gives the same bytes,
// package included, as the golden svg.test.ts writes under Node.
import { createRegistry, type ShapeDef } from '@fluxion/core';
import { builtinRegistries } from '@fluxion/render';
import type { DocumentFile } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { exportSvg } from './svg.js';

declare global {
  interface ImportMeta {
    /** Vite's build-time glob import (vitest runs this file through Vite). */
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}

// the registry svg.test.ts exports its goldens with
const shapeDefs = createRegistry<string, ShapeDef>('shapeDefs');
shapeDefs.register('basic:rect', { id: 'basic:rect', outline: { path: 'M 0 0 L {w} 0 L {w} {h} L 0 {h} Z' }, defaultSize: { w: 160, h: 100 } }, 'test');
const q = 'min(r, w/2, h/2)';
shapeDefs.register(
  'basic:rounded-rect',
  {
    id: 'basic:rounded-rect',
    params: { r: { type: 'number', min: 0, max: 1000, default: 12 } },
    outline: {
      path: `M {${q}} 0 H {w - ${q}} A {${q}} {${q}} 0 0 1 {w} {${q}} V {h - ${q}} A {${q}} {${q}} 0 0 1 {w - ${q}} {h} H {${q}} A {${q}} {${q}} 0 0 1 0 {h - ${q}} V {${q}} A {${q}} {${q}} 0 0 1 {${q}} 0 Z`,
    },
    defaultSize: { w: 160, h: 100 },
  },
  'test',
);
const registries = builtinRegistries(shapeDefs);

const docs = import.meta.glob('../../../fixtures/docs/{rich-text,two-rects-line}.flux.json', { query: '?raw', import: 'default', eager: true });
const goldens = import.meta.glob('../__golden__/{rich-text,two-rects-line}.svg', { query: '?raw', import: 'default', eager: true });

describe('exportSvg in the browser (ADR-0056, M20.43)', () => {
  it("FR-EXP-004: the studio's export bytes equal Node's for the same fixture", async () => {
    for (const name of ['rich-text', 'two-rects-line']) {
      const file = JSON.parse(docs[`../../../fixtures/docs/${name}.flux.json`] as string) as DocumentFile;
      const { svg } = await exportSvg(file, {}, { registries });
      expect(svg, name).toBe(goldens[`../__golden__/${name}.svg`]);
    }
  });
});
