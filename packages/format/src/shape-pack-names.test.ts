// FR-LIB-009 FR-LIB-003: a pack 1.2 subset (ADR-0210, M18.211) in a saved file: a save keeps only the names of the categories it
// uses, and a 1.2 distribution saves as a 1.2 subset with its index's names. The frozen fixtures/shape-pack/v1.2/labels.flux and its
// font checks at the lock are in packages/editor/src/shape-pack-format-compat.test.ts.
import { allowsShapePackContentLicense, type ShapePackSubset11 } from '@fluxion/core';
import type { QualifiedName, Result } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { decodeBase64 } from './base64.js';
import { loadFlux, writePortableFlux } from './index.js';
import { sha256Hex } from './sha256.js';

declare global {
  interface ImportMeta {
    glob(pattern: string, options: { readonly query: '?inline'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}
const json = import.meta.glob('../../../fixtures/shape-pack/v1.2/**/*.json', { query: '?raw', import: 'default', eager: true });
const fixture = (path: string) => JSON.parse(json[`../../../fixtures/shape-pack/v1.2/${path}`] ?? 'null');
/** A binary fixture's bytes, inlined as a data URL by the bundler. */
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
const input = (ids: readonly QualifiedName[], source: unknown) => {
  const b = documentBuilder();
  const screen = b.screen();
  for (const defId of ids) b.rect(screen, { defId });
  return {
    document: b.build(),
    hasher,
    appVersion: '0.0.0',
    shapePacks: { sources: [source] as never, builtinIds: new Set<string>(), licensePolicy: policy },
  };
};
const fonts = () => new Map([[SHA, INTER.slice()]]);

describe('a 1.2 subset in a saved file (ADR-0210)', () => {
  it('FR-LIB-003: a save keeps the names of only the categories it uses, and stays 1.2 when none is left', async () => {
    const subset = fixture('subset.json');
    // box moves to a second named category; saving the label alone drops that name
    const [box, label] = subset.definitions;
    const two = { ...subset, definitions: [{ ...box, category: 'misc' }, label], categoryNames: { labels: 'Labels & Badges', misc: 'Misc & More' } };
    const saved = value(await writePortableFlux(input(['sample:label'], { kind: 'embedded', subset: two, fonts: fonts() })));
    const [pack] = value(await loadFlux(saved.bytes, options)).shapePacks as ShapePackSubset11[];
    expect(pack?.categoryNames).toEqual({ labels: 'Labels & Badges' });
    const boxOnly = value(
      await writePortableFlux(input(['sample:box'], { kind: 'embedded', subset: { ...two, categoryNames: { labels: 'Labels & Badges' } } })),
    );
    const opened = value(await loadFlux(boxOnly.bytes, options));
    expect(opened.manifest?.plugins?.[0]).toMatchObject({ packFormat: '1.2' });
    expect(opened.shapePacks[0]).toMatchObject({ formatVersion: '1.2' });
    expect(opened.shapePacks[0]).not.toHaveProperty('categoryNames');
  });

  it('FR-LIB-009: a 1.2 distribution saves as a 1.2 subset carrying its index names', async () => {
    const index = fixture('index.json');
    const { definitions } = fixture('categories/labels.json');
    const saved = value(await writePortableFlux(input(['sample:label'], { kind: 'distribution', index, definitions, fonts: fonts() })));
    const [pack] = value(await loadFlux(saved.bytes, options)).shapePacks as ShapePackSubset11[];
    expect(pack).toMatchObject({ formatVersion: '1.2', categoryNames: { labels: 'Labels & Badges' } });
    expect(pack?.fontResources.map((r) => r.sha256)).toEqual([SHA]);
  });
});
