import { allowsShapePackContentLicense, type ShapePackSubset } from '@fluxion/core';
import { sha256Hex, writePortableFlux } from '@fluxion/format';
import type { QualifiedName } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { expect, it } from 'vitest';
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
