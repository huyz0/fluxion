// FR-SHP-007: a pack 1.3 subset (ADR-0054, M19.34) in a saved file. A save that uses a definition with icon slots writes a 1.3 subset
// and lock, which reopens with the slots through both loaders; a save that uses none of them writes 1.2 (1.3 is 1.2 plus icon slots),
// so the file stays readable by a 1.2 reader. fixtures/shape-pack/v1.3/subset.json is v1.2's with a badge slot on sample:box.
import { allowsShapePackContentLicense, type ShapePackSubset11 } from '@fluxion/core';
import type { QualifiedName, Result } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { decodeBase64 } from './base64.js';
import { loadFlux, writePortableFlux } from './index.js';
import { loadFluxLean } from './lean.js';
import { sha256Hex } from './sha256.js';

declare global {
  interface ImportMeta {
    glob(pattern: string, options: { readonly query: '?inline'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}
const json = import.meta.glob('../../../fixtures/shape-pack/v1.3/*.json', { query: '?raw', import: 'default', eager: true });
const SUBSET = JSON.parse(json['../../../fixtures/shape-pack/v1.3/subset.json'] ?? 'null');
const bytesOf = (inlined: Record<string, string>): Uint8Array => {
  const url = Object.values(inlined)[0] ?? '';
  return decodeBase64(url.slice(url.indexOf(',') + 1)) ?? new Uint8Array();
};
const INTER = bytesOf(import.meta.glob('../../../packs/fonts-core/fonts/inter-latin-400-normal.woff2', { query: '?inline', import: 'default', eager: true }));
const SHA = sha256Hex(INTER);
const hasher = { sha256: async (bytes: Uint8Array) => sha256Hex(bytes) };
const policy = allowsShapePackContentLicense;
const options = { hasher, shapePackLicensePolicy: policy };
function value<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}
const save = (ids: readonly QualifiedName[]) => {
  const b = documentBuilder();
  const screen = b.screen();
  for (const defId of ids) b.rect(screen, { defId });
  const source = { kind: 'embedded', subset: SUBSET, fonts: new Map([[SHA, INTER.slice()]]) };
  return writePortableFlux({
    document: b.build(),
    hasher,
    appVersion: '0.0.0',
    shapePacks: { sources: [source] as never, builtinIds: new Set<string>(), licensePolicy: policy },
  });
};

describe('a 1.3 subset in a saved file (ADR-0054)', () => {
  it('FR-SHP-007: a save using a slotted definition writes a 1.3 lock and subset that reopen with the slot through both loaders', async () => {
    const saved = value(await save(['sample:box', 'sample:label']));
    for (const load of [loadFlux, loadFluxLean]) {
      const opened = value(await load(saved.bytes, options));
      expect(opened.manifest?.plugins?.[0]).toMatchObject({ packFormat: '1.3' });
      const [pack] = opened.shapePacks as ShapePackSubset11[];
      expect(pack?.formatVersion).toBe('1.3');
      expect(pack?.definitions.find((d) => d.id === 'sample:box')?.iconSlots).toEqual([{ name: 'badge', x: 0.05, y: 0.1, w: 0.2, h: 0.8 }]);
      expect(pack?.fontResources.map((r) => r.sha256)).toEqual([SHA]);
    }
  });

  it('FR-SHP-007: a save using no slotted definition writes 1.2, with the names and fonts it keeps', async () => {
    const opened = value(await loadFlux(value(await save(['sample:label'])).bytes, options));
    expect(opened.manifest?.plugins?.[0]).toMatchObject({ packFormat: '1.2' });
    const [pack] = opened.shapePacks as ShapePackSubset11[];
    expect(pack).toMatchObject({ formatVersion: '1.2', categoryNames: { labels: 'Labels & Badges' } });
    expect(pack?.definitions.map((d) => d.id)).toEqual(['sample:label']);
    expect(pack?.fontResources.map((r) => r.sha256)).toEqual([SHA]);
  });
});
