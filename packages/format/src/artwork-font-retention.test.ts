import { allowsShapePackContentLicense, type ShapePackSubset11, type VersionedShapePackSubset } from '@fluxion/core';
import type { QualifiedName, Result } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { expect, it } from 'vitest';
import { decodeBase64 } from './base64.js';
import { loadFlux, readFluxHtml, readZip, writePortableFlux, writePortableFluxHtml, writeZip } from './index.js';
import { loadFluxLean } from './lean.js';
import { sha256Hex } from './sha256.js';
import { shapePackLock10Schema } from './shape-pack-lock.js';
import { decodeUtf8, encodeUtf8 } from './utf8.js';

declare global {
  interface ImportMeta {
    glob(pattern: string, options: { readonly query: '?inline'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}
const json = import.meta.glob('../../../fixtures/shape-pack/v1.1/**/*.json', { query: '?raw', import: 'default', eager: true });
const fontFiles = import.meta.glob('../../../packs/fonts-core/fonts/inter-latin-400-normal.woff2', { query: '?inline', import: 'default', eager: true });
const fixture = (path: string) => JSON.parse(json[`../../../fixtures/shape-pack/v1.1/${path}`] ?? 'null');
const inline = Object.values(fontFiles)[0] ?? '';
const INTER = decodeBase64(inline.slice(inline.indexOf(',') + 1)) ?? new Uint8Array();
const SHA = sha256Hex(INTER);
const ASSET = `assets/${SHA}.woff2`;
const hasher = { sha256: async (bytes: Uint8Array) => sha256Hex(bytes) };
const policy = allowsShapePackContentLicense;
const options = { hasher, shapePackLicensePolicy: policy };
const fonts = () => new Map([[SHA, INTER.slice()]]);
function value<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}
function document(ids: readonly QualifiedName[]) {
  const b = documentBuilder();
  const screen = b.screen();
  for (const defId of ids) b.rect(screen, { defId });
  return b.build();
}
/** The full fixture pack as an embedded 1.1 source: label (Inter), badge (Brand Sans, same binary) and text-free box. */
function fullSubset(namespace = 'sample'): ShapePackSubset11 {
  const index = fixture('index.json');
  const category = fixture('categories/labels.json');
  const rename = (id: string) => id.replace(/^sample:/, `${namespace}:`);
  const definitions = category.definitions.map((d: { id: string; category?: string; keywords?: string[] }) => {
    const { category: _c, keywords: _k, ...rest } = d;
    return { ...rest, id: rename(d.id) };
  });
  return {
    format: 'fluxion-shape-pack',
    formatVersion: '1.1',
    id: namespace,
    version: index.version,
    license: index.license,
    attribution: index.attribution,
    credits: index.credits,
    definitions,
    fontResources: index.fontResources.map(({ path: _p, ...r }: { path: string }) => r),
    fontFaces: index.fontFaces,
    definitionFonts: index.definitionFonts.map((b: { definitionId: string; faceIds: string[] }) => ({ ...b, definitionId: rename(b.definitionId) })),
    fontCredits: index.fontCredits.map((c: { definitionIds: string[] }) => ({ ...c, definitionIds: c.definitionIds.map(rename) })),
  };
}
const input = (ids: readonly QualifiedName[], sources: readonly unknown[] = [{ kind: 'embedded', subset: fullSubset(), fonts: fonts() }]) => ({
  document: document(ids),
  hasher,
  appVersion: '0.0.0',
  shapePacks: { sources: sources as never, builtinIds: new Set<string>(), licensePolicy: policy },
});
const loaders = [loadFlux, loadFluxLean];

it('FR-AST-003 NFR-LIC-003: archive and inline saves retain the exact used font bytes, a 1.1 lock and the scoped font credit, and reopen offline', async () => {
  const saved = value(await writePortableFlux(input(['sample:label'])));
  const html = value(
    await writePortableFluxHtml({ hasher, playerScript: 'globalThis.Fluxion={start(){}};', title: 'Fonts', archive: input(['sample:label']) }),
  );
  for (const bytes of [saved.bytes, value(await readFluxHtml(html.html, hasher))]) {
    for (const load of loaders) {
      const opened = value(await load(bytes, options));
      expect(opened.notes).toEqual([]);
      expect(opened.manifest?.plugins).toEqual([expect.objectContaining({ kind: 'declarative-shapes', id: 'sample', packFormat: '1.1' })]);
      const [pack] = opened.shapePacks as ShapePackSubset11[];
      expect(pack?.formatVersion).toBe('1.1');
      expect(pack?.definitions.map((d) => d.id)).toEqual(['sample:label']);
      expect(pack?.fontResources).toEqual([{ id: 'inter-400', sha256: SHA, size: INTER.byteLength, mime: 'font/woff2', profile: 'inter-latin-400-ascii' }]);
      expect(pack?.fontFaces.map((f) => f.family)).toEqual(['Inter']);
      expect(pack?.fontCredits).toEqual([expect.objectContaining({ id: 'inter-ofl', resourceIds: ['inter-400'], definitionIds: ['sample:label'] })]);
      expect(pack?.fontCredits[0]?.notice).toBe(fullSubset().fontCredits[0]?.notice);
      expect(opened.assets.get(SHA)?.bytes).toEqual(INTER);
      expect(opened.assets.get(SHA)?.mime).toBe('font/woff2');
    }
  }
  expect([...value(readZip(saved.bytes)).map((e) => e.name)]).toContain(ASSET);
});

it('FR-AST-003 NFR-LIC-003: unused bindings, faces and credit scopes are pruned; a fontless used subset stays 1.1 with no font asset', async () => {
  const both = value(await loadFlux(value(await writePortableFlux(input(['sample:label', 'sample:badge']))).bytes, options));
  const [pack] = both.shapePacks as ShapePackSubset11[];
  expect(pack?.fontFaces.map((f) => f.id)).toEqual(['brand', 'inter']);
  expect(pack?.fontCredits[0]?.definitionIds).toEqual(['sample:badge', 'sample:label']);
  expect(
    value(readZip(value(await writePortableFlux(input(['sample:label', 'sample:badge']))).bytes)).filter((e) => e.name.startsWith('assets/')),
  ).toHaveLength(1);
  // Resave from the loaded file only: remove the label, keep the badge.
  const reloaded = (opened: typeof both, ids: readonly QualifiedName[]) => ({
    ...input(
      ids,
      opened.shapePacks.map((subset: VersionedShapePackSubset) => ({
        kind: 'embedded',
        subset,
        fonts: new Map([...opened.assets].map(([h, a]) => [h, a.bytes])),
      })),
    ),
    plugins: opened.manifest?.plugins ?? [],
    extraEntries: opened.extraEntries,
  });
  const badge = value(await loadFlux(value(await writePortableFlux(reloaded(both, ['sample:badge']))).bytes, options));
  const [kept] = badge.shapePacks as ShapePackSubset11[];
  expect(kept?.definitions.map((d) => d.id)).toEqual(['sample:badge']);
  expect(kept?.fontFaces.map((f) => f.family)).toEqual(['Brand Sans']);
  expect(kept?.definitionFonts).toEqual([{ definitionId: 'sample:badge', faceIds: ['brand'] }]);
  expect(kept?.fontCredits[0]?.definitionIds).toEqual(['sample:badge']);
  const box = value(
    await loadFlux(
      value(await writePortableFlux({ ...input(['sample:box']), plugins: badge.manifest?.plugins ?? [], extraEntries: badge.extraEntries })).bytes,
      options,
    ),
  );
  expect(box.assets.size).toBe(0);
  expect(box.shapePacks).toEqual([expect.objectContaining({ formatVersion: '1.1', fontResources: [], fontFaces: [], definitionFonts: [], fontCredits: [] })]);
  expect(box.manifest?.plugins).toEqual([expect.objectContaining({ packFormat: '1.1' })]);
});

it('FR-AST-003 NFR-LIC-003: packs that share one binary write one asset and keep every used scoped notice', async () => {
  const sources = [
    { kind: 'embedded', subset: fullSubset('sample'), fonts: fonts() },
    {
      kind: 'embedded',
      subset: { ...fullSubset('other'), fontCredits: fullSubset('other').fontCredits.map((c) => ({ ...c, attribution: 'Other attribution' })) },
      fonts: fonts(),
    },
  ];
  const saved = value(await writePortableFlux(input(['sample:label', 'other:badge'], sources)));
  expect(
    value(readZip(saved.bytes))
      .filter((e) => e.name.startsWith('assets/'))
      .map((e) => e.name),
  ).toEqual([ASSET]);
  const opened = value(await loadFlux(saved.bytes, options));
  const credits = (opened.shapePacks as ShapePackSubset11[]).map((p) => [p.id, p.fontCredits.map((c) => [c.attribution, c.definitionIds])]);
  expect(credits).toEqual([
    ['other', [['Other attribution', ['other:badge']]]],
    ['sample', [[fullSubset().fontCredits[0]?.attribution, ['sample:label']]]],
  ]);
});

it('FR-AST-003: a distribution source with acquired font bytes saves the same retained closure', async () => {
  const index = fixture('index.json');
  const { definitions } = fixture('categories/labels.json');
  const saved = value(await writePortableFlux(input(['sample:label'], [{ kind: 'distribution', index, definitions, fonts: fonts() }])));
  const [pack] = value(await loadFlux(saved.bytes, options)).shapePacks as ShapePackSubset11[];
  expect(pack?.fontResources).toEqual([{ id: 'inter-400', sha256: SHA, size: INTER.byteLength, mime: 'font/woff2', profile: 'inter-latin-400-ascii' }]);
  expect(pack?.definitions[0]?.artwork).toEqual(definitions[1].artwork);
});

it('FR-AST-003 NFR-SEC-001: saving refuses missing or different font bytes instead of dropping or substituting them', async () => {
  const other = INTER.slice();
  other[200] = (other[200] ?? 0) ^ 1;
  for (const [name, map] of [
    ['no fonts', undefined],
    ['other bytes', new Map([[SHA, other]])],
    ['short bytes', new Map([[SHA, INTER.slice(0, -1)]])],
  ] as const) {
    const source = { kind: 'embedded', subset: fullSubset(), ...(map ? { fonts: map } : {}) };
    expect((await writePortableFlux(input(['sample:label'], [source]))).ok, name).toBe(false);
  }
  expect((await writePortableFlux(input(['sample:box'], [{ kind: 'embedded', subset: fullSubset() }]))).ok).toBe(true);
});

it('FR-AST-003 NFR-SEC-001: readers rehash retained fonts; a missing or changed font asset refuses the whole file', async () => {
  const saved = value(await writePortableFlux(input(['sample:label'])));
  const entries = value(readZip(saved.bytes));
  const changed = INTER.slice();
  changed[300] = (changed[300] ?? 0) ^ 1;
  const variants = {
    missing: entries.filter((e) => e.name !== ASSET),
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

it('FR-AST-003: the unchanged 1.0 lock contract refuses 1.1 locks, and a lock must match its entry format', async () => {
  const saved = value(await writePortableFlux(input(['sample:label'])));
  const lock = value(await loadFlux(saved.bytes, options)).manifest?.plugins?.[0];
  expect(shapePackLock10Schema.safeParse(lock).success).toBe(false);
  expect(shapePackLock10Schema.safeParse({ ...(lock as object), packFormat: '1.0' }).success).toBe(true);
  const relabel = async (bytes: Uint8Array, from: string, to: string) => {
    const entries = value(readZip(bytes));
    const manifest = entries.find((e) => e.name === 'manifest.json');
    const original = decodeUtf8(manifest?.bytes ?? new Uint8Array());
    const text = original.replace(new RegExp(`"packFormat":\\s*"${from}"`), `"packFormat":"${to}"`);
    expect(text).not.toBe(original);
    const opened = await loadFlux(value(writeZip(entries.map((e) => ({ name: e.name, bytes: e === manifest ? encodeUtf8(text) : e.bytes })))), options);
    expect(opened.ok).toBe(false);
    return opened.ok ? undefined : opened.error;
  };
  // A 1.0 lock reads its entry with the unchanged 1.0 parser, which refuses the 1.1 entry.
  expect((await relabel(saved.bytes, '1.1', '1.0'))?.code).toBe('FILE_SHAPE_PACK_INVALID');
  // A 1.1 lock over a 1.0 entry is refused rather than read as fontless 1.1.
  const legacy = JSON.parse(json['../../../fixtures/shape-pack/v1.1/subset.json'] ?? 'null');
  const old = { ...legacy, formatVersion: '1.0', definitions: [legacy.definitions[0]] };
  for (const key of ['fontResources', 'fontFaces', 'definitionFonts', 'fontCredits']) delete old[key];
  const oldFile = value(await writePortableFlux(input(['sample:box'], [{ kind: 'embedded', subset: old }])));
  expect((await relabel(oldFile.bytes, '1.0', '1.1'))?.message).toBe('shape entry format differs from its lock');
});

it('FR-AST-003: a save retaining fonts is checked against the destination loader limits, entries and bytes included', async () => {
  expect((await writePortableFlux({ ...input(['sample:label']), destinationLimits: { maxEntries: 4 } })).ok).toBe(false);
  expect((await writePortableFlux({ ...input(['sample:label']), destinationLimits: { maxTotalBytes: INTER.byteLength } })).ok).toBe(false);
  expect((await writePortableFlux({ ...input(['sample:label']), destinationLimits: { maxEntries: 64 } })).ok).toBe(true);
});

it('FR-AST-003: omitted or partial destination limits default to the loader limits, which the saved file must also pass', async () => {
  // One byte over the loader's 128 MiB entry limit; zip's own default would accept it.
  const big = new Uint8Array(128 * 1024 * 1024 + 1);
  const bigHash = 'b'.repeat(64);
  // Hashing 128 MiB in the pure port is slow under a loaded suite; this port answers for the big asset by size.
  const fast = { sha256: async (bytes: Uint8Array) => (bytes.byteLength === big.byteLength ? bigHash : sha256Hex(bytes)) };
  const assets = new Map([[bigHash, { bytes: big, mime: 'image/png', ext: 'png' }]]);
  for (const destinationLimits of [undefined, { maxEntries: 64 }]) {
    const saved = await writePortableFlux({ ...input(['sample:label']), hasher: fast, assets, ...(destinationLimits ? { destinationLimits } : {}) });
    expect(saved, JSON.stringify(destinationLimits)).toMatchObject({ ok: false, error: { reason: expect.stringContaining('destination loader limits') } });
  }
}, 60_000);
