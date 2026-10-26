import { allowsShapePackContentLicense, createRegistry, registerShapePackSubsets, type ShapeDef } from '@fluxion/core';
import { parseDocument, type Result, SCHEMA_VERSION } from '@fluxion/schema';
import { expect, it } from 'vitest';
import { loadFlux, readZip, writePortableFlux } from './index.js';
import { loadFluxLean } from './lean.js';
import { portableDistribution, portableDocument, usedIds } from './portable-shape-fixture.js';
import { sha256Hex } from './sha256.js';

const value = <T, E>(r: Result<T, E>): T => {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
};
const hasher = { sha256: async (bytes: Uint8Array) => sha256Hex(bytes) };
const licensePolicy = allowsShapePackContentLicense;
const builtinIds = new Set(['basic:rect', 'basic:rounded-rect', 'basic:cylinder']);
const readOptions = { hasher, shapePackLicensePolicy: licensePolicy };
const files = import.meta.glob('../../schema/src/__fixtures__/**/*.flux.json', { query: '?raw', import: 'default', eager: true });

it('FR-LIB-009: an actual archive embeds exactly three of 5000 definitions and restores their original geometry without distribution access', async () => {
  const source = portableDistribution();
  expect(source.definitions).toHaveLength(5000);
  const expected = source.definitions.filter((def) => usedIds.includes(def.id)).sort((a, b) => a.id.localeCompare(b.id));
  const document = portableDocument();
  const input = { document, hasher, appVersion: '0', shapePacks: { sources: [source], builtinIds, licensePolicy } };
  const saved = value(await writePortableFlux(input));
  const repeated = value(await writePortableFlux(input));
  expect(repeated.bytes).toEqual(saved.bytes);
  expect(
    value(readZip(saved.bytes))
      .filter((entry) => entry.name.startsWith('plugins/'))
      .map((entry) => entry.name),
  ).toEqual(['plugins/portable@1.0.0/defs.json']);
  // Destroy distribution geometry: both readers and the restored registry get only saved bytes.
  source.definitions.splice(0);
  for (const reader of [loadFlux, loadFluxLean]) {
    const loaded = value(await reader(saved.bytes, readOptions));
    expect(loaded.shapePacks).toHaveLength(1);
    expect(loaded.shapePacks[0]?.definitions).toEqual(expected);
    const registry = createRegistry<string, ShapeDef>('offline');
    value(registerShapePackSubsets(registry, loaded.shapePacks, licensePolicy));
    expect(registry.list().map(([id]) => id)).toEqual([...usedIds].sort());
    for (const definition of expected) expect(registry.get(definition.id)).toEqual(definition);
    expect(loaded.document).toEqual(document);
  }
});

it('FR-LIB-009 NFR-REL-002: migration preserves custom shape references, while invalid reference fixtures cannot be silently repaired on save', async () => {
  const legacy = JSON.parse(files['../../schema/src/__fixtures__/v1.0/document.flux.json'] as string);
  const shape = Object.values(legacy.records).find((record) => typeof record === 'object' && record !== null && 'defId' in record);
  if (!shape) throw new Error('legacy fixture has no shape');
  Object.assign(shape, { defId: usedIds[0] });
  const migrated = value(parseDocument(JSON.stringify(legacy))).document;
  expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
  expect(Object.values(migrated.records).some((record) => record['defId'] === usedIds[0])).toBe(true);
  const input = { document: migrated, hasher, appVersion: '0', shapePacks: { sources: [portableDistribution()], builtinIds, licensePolicy } };
  const loaded = value(await loadFlux(value(await writePortableFlux(input)).bytes, readOptions));
  expect(loaded.document).toEqual(migrated);
  expect(loaded.shapePacks[0]?.definitions.map((def) => def.id)).toEqual([usedIds[0]]);
  const invalid = JSON.parse(files['../../schema/src/__fixtures__/invalid/references.flux.json'] as string);
  expect(await writePortableFlux({ ...input, document: invalid })).toMatchObject({ ok: false });
  expect(await writePortableFlux({ ...input, document: portableDocument(['portable:missing']) })).toMatchObject({ ok: false });
});
