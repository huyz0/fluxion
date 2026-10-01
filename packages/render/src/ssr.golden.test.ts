import type { DocumentFile } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { normalizeSvg } from './golden.js';
import { renderDocumentToHtml } from './ssr.js';
import { testRegistries } from './test-registries.js';

declare global {
  interface ImportMeta {
    /** Vite's build-time glob import (vitest runs this file through Vite). */
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}

// the shared valid fixtures at the repo root (scripts/fixtures/gen.mjs); invalid-* do not load
const FIXTURES = Object.entries(import.meta.glob('../../../fixtures/docs/*.flux.json', { query: '?raw', import: 'default', eager: true }))
  .filter(([path]) => !path.includes('/invalid-'))
  // the shapes gallery needs the basic pack: its golden is the CLI's, which bundles the pack (M5.24);
  // so does the drag benchmark, which has no golden (a benchmark, not a rendering reference), and the
  // rich-text fixture (shape labels; its goldens are one per mark and block, M7.9, and its parity is E2E)
  .filter(([path]) => !path.includes('/shapes-gallery.') && !path.includes('/perf-') && !path.includes('/rich-text.'))
  .map(([path, text]) => [(path.split('/').at(-1) ?? path).replace('.flux.json', ''), JSON.parse(text) as DocumentFile] as const);

// the fixture goldens render through ssr.ts: this file carries ssr's stem, so the coverage sandbox
// drops it together with ssr.ts (a browser-covered module)
describe('SVG goldens (NFR-REL-005, FR-SCR-001)', () => {
  it('NFR-REL-005: SVG goldens match and a second render is byte-identical', async () => {
    expect(FIXTURES.map(([name]) => name)).toEqual(['minimal', 'two-rects-line', 'unknown-kind']);
    for (const [name, file] of FIXTURES) {
      const svg = normalizeSvg(renderDocumentToHtml(file, { registries: testRegistries() }).html);
      // rendered twice from a fresh store: the same bytes
      expect(normalizeSvg(renderDocumentToHtml(file, { registries: testRegistries() }).html), name).toBe(svg);
      await expect(svg, name).toMatchFileSnapshot(`../__golden__/${name}.svg`);
    }
  });
});
