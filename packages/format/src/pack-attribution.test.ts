import { allowsShapePackContentLicense } from '@fluxion/core';
import type { Result } from '@fluxion/schema';
import { expect, it } from 'vitest';
import { loadFlux, readFluxHtml, writePortableFlux, writePortableFluxHtml } from './index.js';
import { portableDistribution, portableDocument } from './portable-shape-fixture.js';
import { sha256Hex } from './sha256.js';

const value = <T, E>(r: Result<T, E>): T => {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
};
const hasher = { sha256: async (bytes: Uint8Array) => sha256Hex(bytes) };
const licensePolicy = allowsShapePackContentLicense;
const builtinIds = new Set(['basic:rect']);
const readOptions = { hasher, shapePackLicensePolicy: licensePolicy };

it('FR-LIB-009 NFR-LIC-003: all applicable notices survive ZIP and HTML; unused scoped credits do not leak into the saved subset', async () => {
  const source = portableDistribution();
  const archive = { document: portableDocument(), hasher, appVersion: '0', shapePacks: { sources: [source], builtinIds, licensePolicy } };
  const zip = value(await writePortableFlux(archive)).bytes;
  const html = value(await writePortableFluxHtml({ archive, hasher, title: 'Attribution', playerScript: 'globalThis.Fluxion={start(){}};' }));
  const extracted = value(await readFluxHtml(html.html, hasher));
  const expected = [source.index.credits[0], { ...source.index.credits[1], definitionIds: ['portable:s0', 'portable:s7'] }];
  for (const bytes of [zip, extracted]) {
    const loaded = value(await loadFlux(bytes, readOptions));
    expect(loaded.shapePacks[0]?.credits).toEqual(expected);
    const reduced = value(
      await writePortableFlux({
        ...archive,
        document: portableDocument(['portable:s23']),
        plugins: loaded.manifest?.plugins ?? [],
        extraEntries: loaded.extraEntries,
        shapePacks: { builtinIds, licensePolicy, sources: loaded.shapePacks.map((subset) => ({ kind: 'embedded' as const, subset })) },
      }),
    );
    const reopened = value(await loadFlux(reduced.bytes, readOptions));
    expect(reopened.shapePacks[0]?.definitions.map((def) => def.id)).toEqual(['portable:s23']);
    expect(reopened.shapePacks[0]?.credits).toEqual([source.index.credits[0]]);
  }
});
