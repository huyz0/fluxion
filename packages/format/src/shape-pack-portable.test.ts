import { allowsShapePackContentLicense, type ShapePackSubset } from '@fluxion/core';
import { DIAGNOSTIC_CODES, type QualifiedName, type Result } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { expect, it } from 'vitest';
import { loadFlux, readFluxHtml, writeFlux, writePortableFlux, writePortableFluxHtml } from './index.js';
import { loadFluxLean } from './lean.js';
import { sha256Hex } from './sha256.js';

const files = import.meta.glob('../../../fixtures/shape-pack/subset.json', { query: '?raw', import: 'default', eager: true });
const subset = (): ShapePackSubset => JSON.parse(Object.values(files)[0] ?? 'null');
const locks = import.meta.glob('../../../fixtures/shape-pack/portable-lock.json', { query: '?raw', import: 'default', eager: true });
const expectedLock = () => JSON.parse(Object.values(locks)[0] ?? 'null');
function value<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}
function document(ids: readonly QualifiedName[] = ['sample:box', 'sample:triangle']) {
  const b = documentBuilder();
  const screen = b.screen();
  for (const defId of ids) b.rect(screen, { defId });
  return b.build();
}
const hasher = { sha256: async (bytes: Uint8Array) => sha256Hex(bytes) };
const policy = allowsShapePackContentLicense;
const options = { hasher, shapePackLicensePolicy: policy };
const input = () => ({
  document: document(),
  hasher,
  appVersion: '0.0.0',
  shapePacks: { sources: [{ kind: 'embedded' as const, subset: subset() }], builtinIds: new Set(['basic:rect']), licensePolicy: policy },
});
const htmlOptions = { hasher, playerScript: 'globalThis.Fluxion={start(){}};', title: 'Portable fixture' };

it('FR-LIB-009 NFR-LIC-003: portable ZIP and HTML reopen with identical used geometry and credits through both loaders', async () => {
  const prepared = value(await writePortableFlux(input()));
  expect(prepared.diagnostics).toEqual([]);
  for (const load of [loadFlux, loadFluxLean]) {
    const opened = value(await load(prepared.bytes, options));
    expect(opened.shapePacks).toEqual([subset()]);
    expect(opened.manifest?.plugins).toEqual([expectedLock()]);
    expect(opened.notes).toEqual([]);
  }
  const html = value(await writePortableFluxHtml({ ...htmlOptions, archive: input() }));
  expect(html.diagnostics).toEqual([]);
  const bytes = value(await readFluxHtml(html.html, hasher));
  expect(value(await loadFlux(bytes, options)).shapePacks).toEqual([subset()]);
});

it('FR-LIB-009: offline remove and resave uses only loaded subsets while preserving opaque plugin bytes and locks', async () => {
  const opaque = { kind: 'future-code', id: 'future', custom: { x: 1 } };
  const extra = new Uint8Array([0, 255, 17]);
  const saved = value(await writePortableFlux({ ...input(), plugins: [opaque], extraEntries: new Map([['plugins/future/data.bin', extra]]) }));
  const opened = value(await loadFlux(saved.bytes, options));
  const reduced = {
    ...opened.document,
    records: Object.fromEntries(Object.entries(opened.document.records).filter(([, r]) => r['defId'] !== 'sample:triangle')),
  };
  const resaved = value(
    await writePortableFlux({
      ...input(),
      document: reduced,
      plugins: opened.manifest?.plugins ?? [],
      extraEntries: opened.extraEntries,
      shapePacks: { ...input().shapePacks, sources: opened.shapePacks.map((s) => ({ kind: 'embedded' as const, subset: s })) },
    }),
  );
  const back = value(await loadFlux(resaved.bytes, options));
  expect(back.shapePacks[0]?.definitions.map((d) => d.id)).toEqual(['sample:box']);
  expect(back.shapePacks[0]?.credits).toEqual(subset().credits);
  expect(back.manifest?.plugins).toContainEqual(opaque);
  expect(back.extraEntries.get('plugins/future/data.bin')).toEqual(extra);
  const empty = value(await writePortableFlux({ ...input(), document: document([]), plugins: back.manifest?.plugins ?? [], extraEntries: back.extraEntries }));
  const cleared = value(await loadFlux(empty.bytes, options));
  expect(cleared.shapePacks).toEqual([]);
  expect(cleared.manifest?.plugins).toEqual([opaque]);
  expect([...cleared.extraEntries.keys()]).toEqual(['plugins/future/data.bin']);
});

it('FR-LIB-009: explicit loaded unresolved provenance preserves the reference and returns warnings in ZIP and HTML', async () => {
  const archive = {
    ...input(),
    document: document(['legacy:missing']),
    shapePacks: { ...input().shapePacks, sources: [], preservedUnresolvedIds: new Set(['legacy:missing']) },
  };
  const zip = value(await writePortableFlux(archive));
  expect(zip.diagnostics).toEqual([expect.objectContaining({ code: 'FLX_PACK_UNRESOLVED_PRESERVED', severity: 'warning' })]);
  expect(zip.diagnostics[0]?.message).toContain('legacy:missing');
  expect(DIAGNOSTIC_CODES.FLX_PACK_UNRESOLVED_PRESERVED).toBe('warning');
  const html = value(await writePortableFluxHtml({ ...htmlOptions, archive }));
  expect(html.diagnostics).toEqual(zip.diagnostics);
  const opened = value(await loadFlux(value(await readFluxHtml(html.html, hasher)), options));
  expect(Object.values(opened.document.records).some((r) => r['defId'] === 'legacy:missing')).toBe(true);
  expect(opened.shapePacks).toEqual([]);
  const noProvenance = { ...archive, shapePacks: { ...archive.shapePacks, preservedUnresolvedIds: new Set<string>() } };
  expect(await writePortableFlux(noProvenance)).toMatchObject({ ok: false });
  expect(await writePortableFluxHtml({ ...htmlOptions, archive: noProvenance })).toMatchObject({ ok: false });
});

it('FR-LIB-009: opaque path collisions and malformed original known locks cannot be silently replaced', async () => {
  expect(await writePortableFlux({ ...input(), extraEntries: new Map([['plugins/sample@1.0.0/defs.json', new Uint8Array([1])]]) })).toMatchObject({
    ok: false,
  });
  const old = value(await loadFlux(value(await writePortableFlux(input())).bytes, options));
  const broken = old.manifest?.plugins?.map((lock) => ({ ...(lock as object), integrity: 'sha256-bad' }));
  expect(await writePortableFlux({ ...input(), plugins: broken ?? [], extraEntries: old.extraEntries })).toMatchObject({ ok: false });
});

it('FR-LIB-009: known data requires explicit policy even through low-level APIs; legacy no-lock files remain compatible', async () => {
  const prepared = value(await writePortableFlux(input()));
  expect(await loadFlux(prepared.bytes, { hasher })).toMatchObject({ ok: false, error: { code: 'FILE_SHAPE_PACK_INVALID' } });
  const old = value(await loadFlux(prepared.bytes, options));
  expect(
    await writeFlux({ document: old.document, hasher, appVersion: '0', plugins: old.manifest?.plugins ?? [], extraEntries: old.extraEntries }),
  ).toMatchObject({ ok: false });
  const legacy = value(await writeFlux({ document: document(['basic:rect']), hasher, appVersion: '0' }));
  expect(value(await loadFlux(legacy, { hasher })).shapePacks).toEqual([]);
});

it('FR-LIB-009: portable composition snapshots document and opaque bytes before asynchronous hashing', async () => {
  const archive = { ...input(), extraEntries: new Map([['plugins/future/blob', new Uint8Array([1, 2, 3])]]) };
  const expected = value(await writePortableFlux(archive));
  let release: (hash: string) => void = () => {
    throw new Error('not started');
  };
  let hash = '';
  let calls = 0;
  const pending = writePortableFlux({
    ...archive,
    hasher: {
      sha256: async (bytes) => {
        const digest = sha256Hex(bytes);
        if (calls++ > 0) return digest;
        hash = digest;
        return new Promise<string>((resolve) => {
          release = resolve;
        });
      },
    },
  });
  for (const record of Object.values(archive.document.records)) if (record['kind'] === 'shape') Object.assign(record, { defId: 'new:missing' });
  archive.extraEntries.get('plugins/future/blob')?.fill(99);
  release(hash);
  expect(value(await pending)).toEqual(expected);
});

it('FR-LIB-009: rejected archive or HTML hash ports return failures without successful partial output', async () => {
  const unavailable = {
    sha256: async (_bytes: Uint8Array): Promise<string> => {
      throw new Error('unavailable');
    },
  };
  expect(await writePortableFlux({ ...input(), hasher: unavailable })).toMatchObject({ ok: false });
  expect(await writePortableFluxHtml({ ...htmlOptions, hasher: unavailable, archive: input() })).toMatchObject({ ok: false });
});

it('FR-LIB-009 NFR-REL-002: snapshotting a portable save never silently repairs or migrates its document', async () => {
  const archive = input();
  const shape = Object.values(archive.document.records).find((record) => record['kind'] === 'shape');
  if (!shape) throw new Error('missing fixture shape');
  Reflect.deleteProperty(shape, 'index');
  expect(await writePortableFlux(archive)).toMatchObject({ ok: false });
  const legacy = input();
  Object.assign(legacy.document, { schemaVersion: '1.6' });
  expect(await writePortableFlux(legacy)).toMatchObject({ ok: false });
});
