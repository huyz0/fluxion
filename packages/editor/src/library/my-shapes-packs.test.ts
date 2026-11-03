import { readFileSync } from 'node:fs';
import { type ArtworkFontBinding, createCore, createRegistry, type ShapeDef, type ShapePackSubset11, type VersionedShapePackSubset } from '@fluxion/core';
import { type ShapePackSourceData, sha256Hex } from '@fluxion/format';
import { registerSavedShapePacks } from '@fluxion/render';
import type { QualifiedName, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMyShapes, exportMyShapes, insertMyShape, type MyShapesPacks, parseMyShapes, type ShapeAvailable, saveMyShape } from './my-shapes.js';
import { type MyShapePack, mergeMyShapePacks, myShapePackSet, packsFor, parseMyShapePacks } from './my-shapes-packs.js';

const root = new URL('../../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root));
/** The 1.1 fixture subset: a text-free box and a label drawn in fonts-core's Inter 400. */
const SUBSET = JSON.parse(read('fixtures/shape-pack/v1.1/subset.json').toString()) as ShapePackSubset11;
/** The 1.0 fixture subset: a box and a triangle, no fonts. */
const SUBSET10 = JSON.parse(read('fixtures/shape-pack/subset.json').toString()) as VersionedShapePackSubset;
const INTER = new Uint8Array(read('packs/fonts-core/fonts/inter-latin-400-normal.woff2'));
const SHA = sha256Hex(INTER);
const hasher = { sha256: async (bytes: Uint8Array) => sha256Hex(bytes) };
const BUILT_IN: ShapeAvailable = (defId) => defId.startsWith('basic:');
const SOURCE = (screen: RecordId) => ({ docId: 'doc-a', screen, endPoint: () => ({ x: 0, y: 0 }) });
const embedded = (subset: VersionedShapePackSubset, fonts = new Map([[SHA, INTER.slice()]])): ShapePackSourceData => ({ kind: 'embedded', subset, fonts });

/** A document with a built-in rectangle and one shape of each of `defIds`; its store, screen and every element. */
function doc(defIds: readonly QualifiedName[]) {
  const b = documentBuilder({ seed: 122 });
  const screen = b.screen();
  const ids = [b.rect(screen, { x: 0, y: 0, w: 80, h: 40 }), ...defIds.map((defId, i) => b.rect(screen, { x: 100 * (i + 1), y: 0, w: 80, h: 40, defId }))];
  return { core: createCore(b.build()), screen, ids };
}

/** A save-time packs port over `sources` (insert is not used). */
const savePacks = (sources: readonly ShapePackSourceData[]): MyShapesPacks => ({
  forSave: (records) => packsFor(records, { sources: () => sources, builtinIds: new Set(['basic:rect']), hasher }),
  forInsert: async () => ({ ok: true, value: undefined }),
});

const registries = () => ({
  shapeDefs: createRegistry<string, ShapeDef>('shapeDefs'),
  artworkFonts: createRegistry<string, readonly ArtworkFontBinding[]>('artworkFonts'),
});
// a 1.0 subset loads no face, so the set is never touched
const ports = { sha256: hasher.sha256, fonts: {} as FontFaceSet };
/** A font set whose faces load at once; node has no FontFace, so a stand-in that loads is installed for the test. */
const fakeFonts = () => {
  vi.stubGlobal(
    'FontFace',
    class {
      status = 'loaded';
      load = async () => this;
    },
  );
  const faces = new Set<unknown>();
  return { add: (f: unknown) => faces.add(f), delete: (f: unknown) => faces.delete(f), has: (f: unknown) => faces.has(f) } as unknown as FontFaceSet;
};

describe('My shapes carry the pack subsets they use (M18.122)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('FR-LIB-008, FR-LIB-009, NFR-LIC-003: WHEN an item uses a 1.1 pack shape THE SYSTEM SHALL carry the used subset with its credits and exact font bytes', async () => {
    const a = doc(['sample:label']);
    const saved = await saveMyShape(
      a.core.store,
      a.ids,
      { id: 'labelled', name: 'Labelled' },
      { source: SOURCE(a.screen), available: BUILT_IN, packs: savePacks([embedded(SUBSET)]) },
    );
    if (!saved.ok) throw new Error(saved.reason);
    const [pack] = saved.value.packs ?? [];
    // narrowed to the shape used: the box is left out, the label keeps its face, resource and font credit
    expect(pack?.subset.definitions.map((d) => d.id)).toEqual(['sample:label']);
    const subset = pack?.subset as ShapePackSubset11;
    expect(subset.fontResources.map((r) => r.sha256)).toEqual([SHA]);
    expect(subset.fontCredits.map((c) => c.definitionIds)).toEqual([['sample:label']]);
    expect(subset.credits).toEqual(SUBSET.credits);
    expect(Uint8Array.from(atob(pack?.fonts[SHA] ?? ''), (c) => c.charCodeAt(0))).toEqual(INTER);
    // the item is a 1.1 file, which reads back, and a host with only the built-in shapes keeps and imports it
    const file = exportMyShapes([saved.value]);
    expect(JSON.parse(file).formatVersion).toBe('1.1');
    expect(parseMyShapes(file, BUILT_IN)).toEqual({ ok: true, value: [saved.value] });
    const map = new Map<string, string>();
    const mine = createMyShapes({ getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) }, BUILT_IN);
    expect(mine.importFile(file)).toEqual({ ok: true, value: 1 });
    expect(mine.put({ ...saved.value, id: 'again' })).toBe(true);
    // an item with only built-in shapes stays a 1.0 file
    const plain = await saveMyShape(
      a.core.store,
      [a.ids[0] as RecordId],
      { id: 'plain', name: 'Plain' },
      { source: SOURCE(a.screen), available: BUILT_IN, packs: savePacks([]) },
    );
    if (!plain.ok) throw new Error(plain.reason);
    expect(plain.value.packs).toBeUndefined();
    expect(JSON.parse(exportMyShapes([plain.value])).formatVersion).toBe('1.0');
  });

  it('FR-LIB-008, NFR-LIC-003: a shape with no pack source, or a font whose bytes are missing, is refused on save', async () => {
    const a = doc(['sample:label', 'other:thing']);
    const save = (packs: MyShapesPacks | undefined, ids = a.ids) =>
      saveMyShape(a.core.store, ids, { id: 'x', name: 'X' }, { source: SOURCE(a.screen), available: BUILT_IN, packs });
    expect(await save(undefined)).toEqual({ ok: false, reason: 'it uses shapes that are not built in: other:thing, sample:label' });
    expect((await save(savePacks([embedded(SUBSET)]))).ok).toBe(false);
    const missingFont = await save(savePacks([embedded(SUBSET, new Map())]), a.ids.slice(0, 2));
    expect(missingFont.ok ? 'saved' : missingFont.reason).toMatch(/font bytes are missing/);
  });

  it('FR-LIB-008, NFR-LIC-003: an imported item whose packs are malformed, repeat a namespace or miss a font is refused whole', () => {
    const pack: MyShapePack = { subset: SUBSET, fonts: { [SHA]: btoa(String.fromCharCode(...INTER)) } };
    expect(parseMyShapePacks([pack])).toEqual([pack]);
    expect(parseMyShapePacks([pack, pack])).toBe('pack 1 repeats namespace sample');
    expect(parseMyShapePacks([{ ...pack, fonts: {} }])).toBe('pack 0: its fonts do not match the subset');
    expect(parseMyShapePacks([{ ...pack, fonts: { [SHA]: '%%%' } }])).toBe(`pack 0: its font ${SHA} is not valid`);
    expect(parseMyShapePacks([{ subset: { ...SUBSET, license: 'LicenseRef-Proprietary' }, fonts: pack.fonts }])).toMatch(/^pack 0: /);
    expect(parseMyShapePacks('x')).toBe('its packs are not a list');
    // packs are a 1.1 field: a 1.0 file holding them is refused
    const item = { id: 'p', name: 'P', payload: { ...JSON.parse('{}'), bounds: { x: 0, y: 0, w: 1, h: 1 } }, packs: [pack] };
    const file = (version: string) => JSON.stringify({ format: 'fluxion-my-shapes', formatVersion: version, items: [item] });
    expect(parseMyShapes(file('1.0'))).toMatchObject({ ok: false });
  });

  it('FR-LIB-008, FR-LIB-009: WHEN an item is inserted THE SYSTEM SHALL register only absent namespaces and refuse a conflicting one with no effect', async () => {
    const pack: MyShapePack = { subset: SUBSET10, fonts: {} };
    const r = registries();
    const set = myShapePackSet(r, ports);
    expect(await set.add([pack])).toEqual({ ok: true, value: undefined });
    expect(r.shapeDefs.list().map(([id]) => id)).toEqual(['sample:box', 'sample:triangle']);
    const sources = set.sources();
    expect(sources).toEqual([expect.objectContaining({ kind: 'embedded', subset: SUBSET10 })]);
    // the same geometry held already: used as it is, nothing registered again, nothing new for the save
    expect(await set.add([pack])).toEqual({ ok: true, value: undefined });
    expect(set.sources()).toBe(sources);
    // other geometry under the held namespace: the whole call is refused, the absent namespace beside it included
    const other = { ...SUBSET10, definitions: SUBSET10.definitions.map((d) => ({ ...d, defaultSize: { w: 1, h: 1 } })) };
    const fresh = {
      ...SUBSET10,
      id: 'fresh',
      definitions: SUBSET10.definitions.map((d) => ({ ...d, id: d.id.replace('sample:', 'fresh:') as QualifiedName })),
    };
    const conflict = await set.add([
      { subset: fresh, fonts: {} },
      { subset: other, fonts: {} },
    ]);
    expect(conflict).toEqual({ ok: false, reason: 'the document has other shapes under sample' });
    expect(r.shapeDefs.list().map(([id]) => id)).toEqual(['sample:box', 'sample:triangle']);
    expect(set.sources()).toBe(sources);
    set.dispose();
    expect(r.shapeDefs.list()).toEqual([]);
    expect(await set.add([pack])).toEqual({ ok: false, reason: 'the packs were released' });
    expect(r.shapeDefs.list()).toEqual([]);
  });

  it('FR-LIB-008, FR-LIB-009: WHEN two items carry different shapes of one pack THE SYSTEM SHALL insert both, and the save embeds one subset of both (M18.122 r1 F2)', async () => {
    const narrowed = async (subset: VersionedShapePackSubset, defId: QualifiedName) => {
      const one = doc([defId]);
      const found = await packsFor(one.ids.map((id) => one.core.store.get(id)) as never, {
        sources: () => [embedded(subset)],
        builtinIds: new Set(['basic:rect']),
        hasher,
      });
      if (!found.ok || found.value[0] === undefined) throw new Error('not narrowed');
      return found.value[0];
    };
    for (const [subset, first, second] of [
      [SUBSET10, 'sample:box', 'sample:triangle'],
      [SUBSET, 'sample:box', 'sample:label'],
    ] as const) {
      const a = await narrowed(subset, first);
      const b = await narrowed(subset, second);
      expect(b.subset.definitions.map((d) => d.id)).toEqual([second]);
      const r = registries();
      const set = myShapePackSet(r, { sha256: hasher.sha256, fonts: fakeFonts() });
      // two inserts at once (a quick double click) run one after the other
      const [one, two] = await Promise.all([set.add([a]), set.add([b])]);
      expect([one, two]).toEqual([
        { ok: true, value: undefined },
        { ok: true, value: undefined },
      ]);
      expect(r.shapeDefs.list().map(([id]) => id)).toEqual([first, second]);
      // one source holds both shapes, so a save of a document using both embeds the pack once
      const [source] = set.sources();
      expect(set.sources()).toHaveLength(1);
      expect(source?.kind === 'embedded' && source.subset.definitions.map((d) => d.id)).toEqual([first, second]);
      const both = doc([first, second]);
      const saved = await packsFor(both.ids.map((id) => both.core.store.get(id)) as never, {
        sources: set.sources,
        builtinIds: new Set(['basic:rect']),
        hasher,
      });
      expect(saved.ok && saved.value.map((p) => p.subset.definitions.map((d) => d.id))).toEqual([[first, second]]);
      set.dispose();
      expect(r.shapeDefs.list()).toEqual([]);
    }
  });

  it('FR-LIB-008, FR-LIB-009: a namespace the document holds otherwise is used only when it has every shape, and a refusal keeps what the set held', async () => {
    const r = registries();
    // the document's own saved subset holds sample:box only
    const box = { ...SUBSET10, definitions: SUBSET10.definitions.filter((d) => d.id === 'sample:box') };
    const held = await registerSavedShapePacks(r, [box], { ...ports, bytesOf: () => undefined, policy: () => true });
    if (!held.ok) throw new Error('not held');
    const set = myShapePackSet(r, ports);
    expect(await set.add([{ subset: box, fonts: {} }])).toEqual({ ok: true, value: undefined });
    expect(set.sources()).toEqual([]);
    expect(await set.add([{ subset: SUBSET10, fonts: {} }])).toEqual({ ok: false, reason: "the document's sample shapes do not include sample:triangle" });
    expect(r.shapeDefs.list().map(([id]) => id)).toEqual(['sample:box']);
    // two items of one pack at other versions cannot share it
    const fresh = (version: string) => ({
      subset: {
        ...SUBSET10,
        id: 'fresh',
        version,
        definitions: SUBSET10.definitions.map((d) => ({ ...d, id: d.id.replace('sample:', 'fresh:') as QualifiedName })),
      },
      fonts: {},
    });
    const one = fresh('1.0.0');
    expect(await set.add([{ ...one, subset: { ...one.subset, definitions: one.subset.definitions.slice(0, 1) } }])).toEqual({ ok: true, value: undefined });
    expect(mergeMyShapePacks(one, fresh('2.0.0'))).toEqual({ ok: false, reason: 'the document has another version of fresh' });
    expect(await set.add([fresh('2.0.0')])).toEqual({ ok: false, reason: 'the document has another version of fresh' });
    expect(r.shapeDefs.list().map(([id]) => id)).toEqual(['fresh:box', 'sample:box']);
    set.dispose();
    held.value.dispose();
  });

  it('FR-LIB-008: an item inserts its carried pack shapes once its packs are registered', async () => {
    const a = doc(['sample:box']);
    const saved = await saveMyShape(
      a.core.store,
      a.ids,
      { id: 'boxed', name: 'Boxed' },
      { source: SOURCE(a.screen), available: BUILT_IN, packs: savePacks([embedded(SUBSET10)]) },
    );
    if (!saved.ok) throw new Error(saved.reason);
    const b = documentBuilder({ seed: 123 });
    const screen = b.screen();
    const core = createCore(b.build());
    let n = 0;
    const deps = {
      view: core.store,
      execute: core.execute,
      seal: () => core.store.history.seal(),
      screen,
      newId: () => `MyNew${String(++n).padStart(11, '0')}` as RecordId,
    };
    const inserted = insertMyShape(deps, saved.value, { x: 0, y: 0 }, BUILT_IN);
    expect(inserted.ok && inserted.value).toHaveLength(2);
    const defIds = core.store.members('byType', 'element').map((id) => (core.store.get(id) as { defId?: string }).defId);
    expect(defIds.sort()).toEqual(['basic:rect', 'sample:box']);
  });
});
