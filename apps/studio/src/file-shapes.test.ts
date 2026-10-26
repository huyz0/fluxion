import { allowsShapePackContentLicense, type ShapePackIndex, type ShapePackSubset } from '@fluxion/core';
import { loadFlux, type ShapePackSourceData, sha256Hex, writeFlux, writePortableFlux } from '@fluxion/format';
import { type QualifiedName, type Result, serializeDocument } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { expect, it } from 'vitest';
import { openDocument } from './bootstrap.js';
import { fileBytes, openFileBytes } from './file-session.js';

const fixtures = import.meta.glob('../../../fixtures/shape-pack/*.json', { query: '?raw', import: 'default', eager: true });
const fixture = (name: string) => JSON.parse(fixtures[`../../../fixtures/shape-pack/${name}.json`] as string);
const subset = (): ShapePackSubset => fixture('subset');
const hasher = { sha256: async (bytes: Uint8Array) => sha256Hex(bytes) };
function value<T, E>(r: Result<T, E>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}
function document(ids: readonly QualifiedName[] = ['sample:box', 'sample:triangle']) {
  const b = documentBuilder();
  const screen = b.screen();
  for (const defId of ids) b.rect(screen, { defId });
  return b.build();
}
const save = { bytesOf: async () => undefined, hasher, appVersion: '0.0.0' };
const sources = (): readonly ShapePackSourceData[] => [{ kind: 'distribution', index: fixture('index') as ShapePackIndex, definitions: subset().definitions }];

it('FR-LIB-009: Studio restores saved geometry before rendering and resaves reduced data with opaque locks and bytes', async () => {
  const opaque = { kind: 'future', id: 'future', value: 7 };
  const bytes = new Uint8Array([0, 255, 1]);
  const written = value(
    await writePortableFlux({
      document: document(),
      hasher,
      appVersion: '0',
      plugins: [opaque],
      extraEntries: new Map([['future/data.bin', bytes]]),
      shapePacks: { sources: sources(), builtinIds: new Set(), licensePolicy: allowsShapePackContentLicense },
    }),
  );
  const opened = value(await openFileBytes('shapes.flux', written.bytes, hasher));
  expect(opened.shapePacks).toEqual([subset()]);
  const host = value(openDocument(opened.document, { shapePacks: opened.shapePacks ?? [] }));
  expect(host.core.registries.shapeDefs.get('sample:box')).toEqual(subset().definitions[0]);
  const saved = value(await fileBytes({ ...save, file: opened, document: document(['sample:box']) }));
  const back = value(await loadFlux(saved.bytes, { hasher, shapePackLicensePolicy: allowsShapePackContentLicense }));
  expect(back.shapePacks[0]?.definitions.map((d) => d.id)).toEqual(['sample:box']);
  expect(back.shapePacks[0]?.credits).toEqual(subset().credits);
  expect(back.manifest?.plugins).toContainEqual(opaque);
  expect(back.extraEntries.get('future/data.bin')).toEqual(bytes);
  const empty = value(await fileBytes({ ...save, file: opened, document: document([]) }));
  const cleared = value(await loadFlux(empty.bytes, { hasher, shapePackLicensePolicy: allowsShapePackContentLicense }));
  expect(cleared.shapePacks).toEqual([]);
  expect(cleared.manifest?.plugins).toEqual([opaque]);
});

it('FR-LIB-009: a new document saves explicit SDK distribution provenance and rejects installed replacement of an embedded namespace', async () => {
  const saved = value(await fileBytes({ ...save, file: undefined, document: document(), shapePackSources: sources() }));
  const opened = value(await openFileBytes('new.flux', saved.bytes, hasher));
  expect(opened.shapePacks).toEqual([subset()]);
  const conflict = await fileBytes({ ...save, file: opened, document: document(), shapePackSources: sources() });
  expect(conflict.ok).toBe(false);
  const other = subset();
  const definition = other.definitions[0];
  if (!definition) throw new Error('fixture definition missing');
  const changedVersion = { ...other, version: '2.0.0', definitions: [{ ...definition, id: 'sample:other' as QualifiedName }] };
  const disjoint = await fileBytes({
    ...save,
    file: opened,
    document: document(['sample:box', 'sample:other']),
    shapePackSources: [{ kind: 'embedded', subset: changedVersion }],
  });
  expect(disjoint.ok).toBe(false);
  expect(opened.shapePacks).toEqual([subset()]);
});

it('FR-LIB-009: only loaded unresolved references survive with warnings; new missing geometry fails', async () => {
  const old = document(['legacy:missing']);
  const archive = value(await writeFlux({ document: old, hasher, appVersion: '0' }));
  for (const [name, bytes] of [
    ['old.flux', archive],
    ['old.flux.json', new TextEncoder().encode(serializeDocument(old))],
  ] as const) {
    const opened = value(await openFileBytes(name, bytes, hasher));
    const saved = value(await fileBytes({ ...save, file: opened, document: old }));
    expect(saved.diagnostics).toEqual([expect.objectContaining({ code: 'FLX_PACK_UNRESOLVED_PRESERVED', severity: 'warning' })]);
    expect((await fileBytes({ ...save, file: opened, document: document(['legacy:new']) })).ok).toBe(false);
  }
  expect((await fileBytes({ ...save, file: undefined, document: old })).ok).toBe(false);
});
