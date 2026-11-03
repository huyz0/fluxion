import { type ArtworkFontBinding, createCore, createRegistry, type VersionedShapePackSubset } from '@fluxion/core';
import { type MyShapePack, packsFor } from '@fluxion/editor';
import { prepareUsedShapePacks, sha256Hex } from '@fluxion/format';
import { documentBuilder } from '@fluxion/schema/testing';
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { builtinShapeIds } from './file-shapes.js';
import { studioMyShapePacks, useMyShapePacks } from './my-shape-packs.js';
import { bundledPackCatalog, documentCatalog } from './pack-catalog.js';

const SUBSET10 = JSON.parse(
  Object.values(import.meta.glob('../../../fixtures/shape-pack/subset.json', { query: '?raw', import: 'default', eager: true }))[0] as string,
) as VersionedShapePackSubset;
const hasher = { sha256: async (bytes: Uint8Array) => sha256Hex(bytes) };

function opened() {
  const b = documentBuilder({ seed: 1220 });
  b.screen();
  return { core: createCore(b.build()), artworkFonts: createRegistry<string, readonly ArtworkFontBinding[]>('artworkFonts') };
}

describe('Studio My shapes packs (M18.122)', () => {
  it('FR-LIB-008, FR-LIB-009: WHEN an item with pack shapes is inserted THE SYSTEM SHALL register its absent namespace and add it to what the next save embeds', async () => {
    const doc = opened();
    const mine = studioMyShapePacks(doc, () => []);
    let changes = 0;
    mine.subscribe(() => changes++);
    const pack: MyShapePack = { subset: SUBSET10, fonts: {} };
    expect(await mine.packs.forInsert([pack])).toEqual({ ok: true, value: undefined });
    expect(doc.core.registries.shapeDefs.get('sample:box')).toBeDefined();
    expect(changes).toBe(1);
    // a second insert of the same pack registers nothing more and adds no second source
    expect(await mine.packs.forInsert([pack])).toEqual({ ok: true, value: undefined });
    expect(mine.sources()).toHaveLength(1);
    // the save of a document using the inserted shape embeds the pack from those sources
    const b = documentBuilder({ seed: 1221 });
    b.rect(b.screen(), { defId: 'sample:triangle' });
    const prepared = await prepareUsedShapePacks(b.build(), mine.sources(), {
      builtinIds: builtinShapeIds,
      licensePolicy: () => true,
      hasher,
    });
    expect(prepared.ok && prepared.value.locks.map((l) => l.id)).toEqual(['sample']);
    // a later saved item finds the inserted pack among the save sources
    const saved = await mine.packs.forSave(Object.values(b.build().records));
    expect(saved.ok && saved.value.map((p) => p.subset.definitions.map((d) => d.id))).toEqual([['sample:triangle']]);
    // closing the document releases what inserts registered and forgets it
    mine.dispose();
    expect(doc.core.registries.shapeDefs.get('sample:box')).toBeUndefined();
    expect(mine.sources()).toEqual([]);
    expect(await mine.packs.forInsert([pack])).toEqual({ ok: false, reason: 'the document closed' });
    expect(doc.core.registries.shapeDefs.get('sample:box')).toBeUndefined();
  });

  it("FR-LIB-008, FR-LIB-009: an item using an installed pack loads its shapes from the library, so the namespace stays the library's (M18.122 r2 F1)", async () => {
    const doc = opened();
    const defs = doc.core.registries.shapeDefs;
    const problems: string[] = [];
    const catalog = documentCatalog(await bundledPackCatalog(hasher), defs, new Set(), (m) => problems.push(m));
    // the item was saved where the library had loaded two flowchart shapes
    expect(await catalog.resolve(['flowchart:data', 'flowchart:database'])).toEqual([]);
    const b = documentBuilder({ seed: 1222 });
    const screen = b.screen();
    b.rect(screen, { defId: 'flowchart:data' });
    b.rect(screen, { defId: 'flowchart:database' });
    const saved = await packsFor(Object.values(b.build().records), { sources: catalog.sources, builtinIds: builtinShapeIds, hasher });
    if (!saved.ok) throw new Error(saved.reason);
    // a new document where the person dropped one of them from the library already
    const fresh = opened();
    const library = documentCatalog(await bundledPackCatalog(hasher), fresh.core.registries.shapeDefs, new Set(), (m) => problems.push(m));
    expect(await library.resolve(['flowchart:data'])).toEqual([]);
    const mine = studioMyShapePacks(fresh, library.sources, (ids) => library.resolve(ids));
    expect(await mine.packs.forInsert(saved.value)).toEqual({ ok: true, value: undefined });
    expect(fresh.core.registries.shapeDefs.get('flowchart:database')).toBeDefined();
    // nothing was registered by the insert, so the library still loads the pack's other shapes and its save embeds them
    expect(mine.sources()).toEqual([]);
    expect(await library.resolve(['flowchart:document'])).toEqual([]);
    expect(problems).toEqual([]);
    const ids = library.sources().flatMap((s) => (s.kind === 'distribution' ? s.definitions.map((d) => d.id) : []));
    expect(ids.sort()).toEqual(['flowchart:data', 'flowchart:database', 'flowchart:document']);
    mine.dispose();
  });

  it('FR-LIB-008: under a development double mount the port is made again, so an insert is not refused as closed (M18.122 r2 F2)', async () => {
    const doc = opened();
    let port: ReturnType<typeof useMyShapePacks> | undefined;
    const Probe = () => {
      port = useMyShapePacks(doc, undefined, () => []);
      return null;
    };
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => root.render(createElement(StrictMode, null, createElement(Probe))));
    expect(await port?.packs.forInsert([{ subset: SUBSET10, fonts: {} }])).toEqual({ ok: true, value: undefined });
    await act(async () => root.render(createElement(StrictMode, null, createElement(Probe))));
    expect(port?.saveSources()).toHaveLength(1);
    await act(async () => root.unmount());
    expect(doc.core.registries.shapeDefs.get('sample:box')).toBeUndefined();
  });
});
