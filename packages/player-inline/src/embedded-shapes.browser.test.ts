import { allowsShapePackContentLicense, artworkFontAlias, type ShapePackSubset, type ShapePackSubset11 } from '@fluxion/core';
import { readZip, sha256Hex, writePortableFlux, writeZip } from '@fluxion/format';
import type { QualifiedName } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { openFlux } from './open-flux.js';

const files = import.meta.glob('../../../fixtures/shape-pack/subset.json', { query: '?raw', import: 'default', eager: true });
const subset = (): ShapePackSubset => JSON.parse(Object.values(files)[0] ?? 'null');
async function archive(pack: ShapePackSubset) {
  const b = documentBuilder();
  const screen = b.screen();
  for (const def of pack.definitions) b.rect(screen, { defId: def.id });
  const result = await writePortableFlux({
    document: b.build(),
    appVersion: '0',
    hasher: { sha256: async (bytes) => sha256Hex(bytes) },
    shapePacks: { sources: [{ kind: 'embedded', subset: pack }], builtinIds: new Set(), licensePolicy: allowsShapePackContentLicense },
  });
  if (!result.ok) throw new Error(result.error.reason);
  return result.value.bytes;
}

it('FR-LIB-009: inline opening restores saved geometry into its own render registry before presentation', async () => {
  const opened = await openFlux(await archive(subset()));
  expect(opened.ok).toBe(true);
  if (!opened.ok) throw new Error(opened.message);
  expect(opened.value.registries.shapeDefs.get('sample:box')).toEqual(subset().definitions[0]);
  expect(opened.value.registries.shapeDefs.get('sample:triangle')).toEqual(subset().definitions[1]);
  opened.value.release();
});

it('FR-LIB-009: an embedded builtin namespace is refused even with disjoint IDs, without leaking state into the next open', async () => {
  const pack = subset();
  const conflicting = {
    ...pack,
    id: 'basic',
    definitions: pack.definitions.map((def) => ({ ...def, id: def.id.replace('sample:', 'basic:portable-') as QualifiedName })),
  };
  const refused = await openFlux(await archive(conflicting));
  expect(refused.ok).toBe(false);
  if (!refused.ok) expect(refused.message).toContain('already registered');
  const next = await openFlux(await archive(pack));
  expect(next.ok).toBe(true);
  if (next.ok) next.value.release();
});

describe('FR-LIB-004 FR-AST-003: retained artwork fonts (M18.97)', () => {
  const v11 = import.meta.glob('../../../fixtures/shape-pack/v1.1/subset.json', { query: '?raw', import: 'default', eager: true });
  const interUrl = import.meta.glob('../../../packs/fonts-core/fonts/inter-latin-400-normal.woff2', {
    query: '?url',
    import: 'default',
    eager: true,
  }) as Record<string, string>;
  const inter = async () => new Uint8Array(await (await fetch(Object.values(interUrl)[0] ?? '')).arrayBuffer());
  const ALIAS = artworkFontAlias('8909904ab6c872eb994093482a88a28eca2cd95912d7b6fecd72103b0dc07edc');
  const aliased = () => [...document.fonts].filter((face) => face.family.replace(/"/g, '') === ALIAS);
  async function archive11(): Promise<Uint8Array> {
    const pack = JSON.parse(Object.values(v11)[0] ?? 'null') as ShapePackSubset11;
    const bytes = await inter();
    const b = documentBuilder();
    const screen = b.screen();
    b.rect(screen, { defId: 'sample:label' });
    const result = await writePortableFlux({
      document: b.build(),
      appVersion: '0',
      hasher: { sha256: async (data) => sha256Hex(data) },
      shapePacks: {
        sources: [{ kind: 'embedded', subset: pack, fonts: new Map([[sha256Hex(bytes), bytes]]) }],
        builtinIds: new Set(),
        licensePolicy: allowsShapePackContentLicense,
      },
    });
    if (!result.ok) throw new Error(result.error.reason);
    return result.value.bytes;
  }

  it('registers the exact retained face under its alias before presenting, and releases it with the file', async () => {
    const opened = await openFlux(await archive11());
    if (!opened.ok) throw new Error(opened.message);
    expect(opened.value.registries.artworkFonts?.get('sample:label')).toEqual([
      { family: 'Inter', weight: 400, style: 'normal', sha256: expect.any(String), alias: ALIAS },
    ]);
    expect(aliased().map((face) => face.status)).toEqual(['loaded']);
    opened.value.release();
    await Promise.resolve();
    expect(aliased()).toEqual([]);
  });

  it('refuses a file whose retained font is missing, leaving no face or shape behind', async () => {
    const entries = readZip(await archive11());
    if (!entries.ok) throw new Error('zip');
    const stripped = writeZip(entries.value.filter((entry) => !entry.name.endsWith('.woff2')).map(({ name, bytes }) => ({ name, bytes })));
    if (!stripped.ok) throw new Error('zip');
    const refused = await openFlux(stripped.value);
    expect(refused.ok).toBe(false);
    expect(aliased()).toEqual([]);
  });

  it('refuses an intact file whose retained face fails to load in the page, then opens it once the page can load it', async () => {
    // the loader has verified the bytes, so only the player's own registration can refuse: its rollback path
    const original = globalThis.FontFace;
    globalThis.FontFace = class extends original {
      override load(): Promise<FontFace> {
        return Promise.reject(new Error('blocked'));
      }
    };
    const bytes = await archive11();
    try {
      const refused = await openFlux(bytes);
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.message).toMatch(/saved shapes could not be registered: .*could not be loaded/);
    } finally {
      globalThis.FontFace = original;
    }
    expect(aliased()).toEqual([]);
    const reopened = await openFlux(bytes);
    if (!reopened.ok) throw new Error(reopened.message);
    reopened.value.release();
  });
});

it('NFR-LIC-003: the player gets the credits the file pins, offline, and a file with no saved shapes has none (ADR-0050)', async () => {
  const pack = subset();
  const opened = await openFlux(await archive(pack));
  if (!opened.ok) throw new Error(opened.message);
  expect(opened.value.credits).toEqual([{ id: pack.id, version: pack.version, license: pack.license, attribution: pack.attribution, credits: pack.credits }]);
  opened.value.release();
  const b = documentBuilder();
  b.screen();
  const written = await writePortableFlux({
    document: b.build(),
    appVersion: '0',
    hasher: { sha256: async (bytes) => sha256Hex(bytes) },
    shapePacks: { sources: [], builtinIds: new Set(), licensePolicy: allowsShapePackContentLicense },
  });
  if (!written.ok) throw new Error(written.error.reason);
  const plain = await openFlux(written.value.bytes);
  if (!plain.ok) throw new Error(plain.message);
  expect(plain.value.credits).toEqual([]);
  plain.value.release();
});
