import { sanitizeSvg } from '@fluxion/format';
import { describe, expect, it } from 'vitest';

declare global {
  interface ImportMeta {
    /** Vite's build-time glob import. */
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}

// the security corpus and the outputs the Node test of `@fluxion/format` pins (scripts/format/corpus.mjs writes them)
const byName = (files: Record<string, string>) => new Map(Object.entries(files).map(([path, text]) => [path.split('/').at(-1) ?? path, text]));
const CASES = byName(import.meta.glob('../../../specs/security/corpus/svg-*.svg', { query: '?raw', import: 'default', eager: true }));
const EXPECTED = byName(import.meta.glob('../../../specs/security/corpus/expected/svg-*.svg', { query: '?raw', import: 'default', eager: true }));

describe('the sanitizer in the browser (NFR-SEC-001)', () => {
  it('NFR-SEC-001: the sanitizer gives the same output in Node and in the browser (every corpus case, in Chromium)', () => {
    expect(CASES.size).toBeGreaterThanOrEqual(17);
    expect([...EXPECTED.keys()].sort()).toEqual([...CASES.keys()].sort());
    for (const [name, text] of CASES) expect(sanitizeSvg(text), name).toBe(EXPECTED.get(name));
  });
});
