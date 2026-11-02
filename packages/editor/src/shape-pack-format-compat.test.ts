import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { allowsShapePackContentLicense, type ShapePackSubset11 } from '@fluxion/core';
import { loadFlux, readZip, writeZip } from '@fluxion/format';
import { loadFluxLean } from '@fluxion/format/player';
import type { Result } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';

// Format compatibility of pack 1.2 (FR-LIB-009, ADR-0210, M18.211). fixtures/shape-pack/v1.2/labels.flux is a portable file written by
// writePortableFlux from fixtures/shape-pack/v1.2/subset.json with sample:label in use: it reopens with its 1.2 lock, its category
// name and its retained Inter through both loaders, and its font asset is still size- and hash-checked at the lock, as in 1.1.
const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
const hasher = { sha256: (b: Uint8Array) => Promise.resolve(sha256(b)) };
const FLUX = new Uint8Array(readFileSync(new URL('../../../fixtures/shape-pack/v1.2/labels.flux', import.meta.url)));
const INTER = new Uint8Array(readFileSync(new URL('../../../packs/fonts-core/fonts/inter-latin-400-normal.woff2', import.meta.url)));
const SHA = sha256(INTER);
const ASSET = `assets/${SHA}.woff2`;
const options = { hasher, shapePackLicensePolicy: allowsShapePackContentLicense };
const loaders = [loadFlux, loadFluxLean];
function value<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

describe('a frozen pack 1.2 file (ADR-0210)', () => {
  it('FR-LIB-009: the frozen labels.flux reopens with its 1.2 lock, its category name and its retained font, through both loaders', async () => {
    for (const load of loaders) {
      const opened = value(await load(FLUX, options));
      expect(opened.notes).toEqual([]);
      expect(opened.manifest?.plugins).toEqual([expect.objectContaining({ kind: 'declarative-shapes', id: 'sample', packFormat: '1.2' })]);
      const [pack] = opened.shapePacks as ShapePackSubset11[];
      expect(pack).toMatchObject({ formatVersion: '1.2', categoryNames: { labels: 'Labels & Badges' } });
      expect(pack?.definitions.map((d) => d.id)).toEqual(['sample:label']);
      expect(pack?.fontCredits).toEqual([expect.objectContaining({ resourceIds: ['inter-400'], definitionIds: ['sample:label'] })]);
      expect(opened.assets.get(SHA)?.bytes).toEqual(INTER);
    }
  });

  it('FR-LIB-009 NFR-SEC-001: a 1.2 lock still checks its font asset: a missing, resized or changed asset refuses the whole file', async () => {
    const entries = value(readZip(FLUX));
    expect(entries.map((e) => e.name)).toContain(ASSET);
    const changed = INTER.slice();
    changed[300] = (changed[300] ?? 0) ^ 1;
    const variants = {
      missing: entries.filter((e) => e.name !== ASSET),
      resized: entries.map((e) => (e.name === ASSET ? { ...e, bytes: INTER.slice(0, INTER.length - 1) } : e)),
      changed: entries.map((e) => (e.name === ASSET ? { ...e, bytes: changed } : e)),
    };
    for (const [name, list] of Object.entries(variants)) {
      const bytes = value(writeZip(list.map((e) => ({ name: e.name, bytes: e.bytes }))));
      for (const load of loaders) {
        const opened = await load(bytes, options);
        expect(opened.ok, name).toBe(false);
        if (!opened.ok) expect(opened.error.code, name).toBe('FILE_SHAPE_PACK_INVALID');
      }
    }
  });
});
