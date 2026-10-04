import { parseDocument } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { writeFlux } from './flux-writer.js';
import { sha256Hex } from './index.js';

declare global {
  interface ImportMeta {
    /** Vite's build-time glob import (vitest runs this file through Vite). */
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}

const only = (found: Record<string, string>, what: string): string => {
  const text = Object.values(found)[0];
  if (text === undefined) throw new Error(`${what} is missing`);
  return text;
};
// the 20-screen document of fixtures/docs (written by scripts/fixtures/gen.mjs) and the budgets of scripts/gates/thresholds.mjs
const doc20 = only(
  import.meta.glob('../../../fixtures/docs/doc20.flux.json', { query: '?raw', import: 'default', eager: true }),
  'fixtures/docs/doc20.flux.json',
);
const thresholds = only(import.meta.glob('../../../scripts/gates/thresholds.mjs', { query: '?raw', import: 'default', eager: true }), 'thresholds.mjs');
const limit = (name: string): number => Number(new RegExp(`${name}: \\{ value: ([0-9_]+)`).exec(thresholds)?.[1]?.replaceAll('_', ''));

describe('the size of a 20-screen document (NFR-SIZE-003)', () => {
  it('NFR-SIZE-003: the fixture is a 20-screen document', () => {
    const parsed = parseDocument(doc20);
    expect(parsed.ok && Object.values(parsed.value.document.records).filter((r) => r.type === 'screen').length).toBe(20);
  });

  it('NFR-SIZE-003: the 20-screen document in .flux is within DOC20_FLUX_BYTES', async () => {
    const parsed = parseDocument(doc20);
    if (!parsed.ok) throw new Error('doc20 does not parse');
    const flux = await writeFlux({ document: parsed.value.document, appVersion: '0.0.0', hasher: { sha256: (bytes) => Promise.resolve(sha256Hex(bytes)) } });
    expect(flux.ok && flux.value.length).toBeGreaterThan(0);
    expect(flux.ok ? flux.value.length : Number.NaN).toBeLessThanOrEqual(limit('DOC20_FLUX_BYTES'));
  });
});
