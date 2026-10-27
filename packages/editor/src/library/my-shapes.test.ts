import { createCore } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import {
  createMyShapes,
  exportMyShapes,
  insertMyShape,
  MY_SHAPES_KEY,
  MY_SHAPES_UNREADABLE_KEY,
  type MyShape,
  parseMyShapes,
  saveMyShape,
} from './my-shapes.js';

type El = { id: RecordId; kind: string; parentId?: RecordId; style?: unknown; text?: unknown; transform: { x: number; y: number; w: number; h: number } };
// a bound end is copied with a point (the editor's comes from routing): the binding written on insert supersedes it
const SOURCE = (screen: RecordId) => ({ docId: 'doc-a', screen, endPoint: () => ({ x: 0, y: 0 }) });
type Binding = { connectorId: RecordId; elementId: RecordId; end: string };

/** Document A: a styled, labelled pair joined by a connector, grouped; the group's id. */
function source() {
  const b = documentBuilder({ seed: 341 });
  const screen = b.screen();
  const left = b.rect(screen, { x: 100, y: 100, w: 120, h: 60, label: 'API', style: { fill: '#ff8800', stroke: { width: 3 } } });
  const right = b.rect(screen, { x: 300, y: 140, w: 80, h: 80, defId: 'basic:ellipse', style: { variant: 'emphasis' } });
  const line = b.connect(left, right, { route: 'orthogonal' });
  const core = createCore(b.build());
  const group = 'MyShapesGroup001' as RecordId;
  const grouped = core.execute('element.group', { ids: [left, right], groupId: group });
  expect(grouped.ok ? 'ok' : JSON.stringify(grouped.error)).toBe('ok');
  // the selection saved: the group and the connector between its members
  return { core, screen, group, picked: [group, line] };
}

/** Document B: an empty screen, and paste deps for it. */
function target() {
  const b = documentBuilder({ seed: 342 });
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
  return { core, deps };
}

const elements = (core: ReturnType<typeof createCore>) => core.store.members('byType', 'element').map((id) => core.store.get(id) as unknown as El);
const bindings = (core: ReturnType<typeof createCore>) => core.store.members('byType', 'binding').map((id) => core.store.get(id) as unknown as Binding);

/** The elements of `core` relative to the bounds of the shapes, by kind and label: geometry and style, ids left out. */
function shapeLook(core: ReturnType<typeof createCore>) {
  const shapes = elements(core).filter((e) => e.kind === 'shape');
  const x0 = Math.min(...shapes.map((s) => s.transform.x));
  const y0 = Math.min(...shapes.map((s) => s.transform.y));
  return shapes
    .map((s) => ({ box: { ...s.transform, x: s.transform.x - x0, y: s.transform.y - y0 }, style: s.style, text: s.text, grouped: s.parentId !== undefined }))
    .sort((a, b) => a.box.x - b.box.x);
}

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
}

describe('My shapes (FR-LIB-008)', () => {
  it('FR-LIB-008: WHEN a styled group is saved, exported and imported THE SYSTEM SHALL insert it into a second document with its geometry, style, text and connector', () => {
    const a = source();
    const item = saveMyShape(a.core.store, a.picked, { id: 'api-pair', name: ' API pair ' }, SOURCE(a.screen));
    expect(item?.name).toBe('API pair');
    const mine = createMyShapes(memoryStorage());
    expect(mine.put(item as MyShape)).toBe(true);
    const file = exportMyShapes(mine.items());

    // another person's My shapes, in another document
    const theirs = createMyShapes(memoryStorage());
    expect(theirs.importFile(file)).toEqual({ ok: true, value: 1 });
    const b = target();
    const roots = insertMyShape(b.deps, theirs.items()[0] as MyShape, { x: 500, y: 400 });
    expect(roots).toHaveLength(2);
    expect(shapeLook(b.core)).toEqual(shapeLook(a.core));
    // the group came along, centred where asked; its connector is bound to both new shapes
    const group = elements(b.core).find((e) => e.kind === 'group') as El;
    expect(group.kind).toBe('group');
    expect(group.transform.x + group.transform.w / 2).toBeCloseTo(500, 6);
    expect(group.transform.y + group.transform.h / 2).toBeCloseTo(400, 6);
    const shapeIds = new Set(
      elements(b.core)
        .filter((e) => e.kind === 'shape')
        .map((e) => e.id),
    );
    expect(bindings(b.core).map((x) => shapeIds.has(x.elementId))).toEqual([true, true]);
    // one undo removes it all
    b.core.store.history.undo();
    expect(elements(b.core)).toEqual([]);
  });

  it('FR-LIB-008: items persist in storage and survive a reload; a damaged stored value is ignored', () => {
    const a = source();
    const storage = memoryStorage();
    const mine = createMyShapes(storage);
    const item = saveMyShape(a.core.store, a.picked, { id: 'pair', name: 'Pair' }, SOURCE(a.screen)) as MyShape;
    mine.put(item);
    mine.put({ ...item, id: 'pair-2', name: 'Pair 2' });
    expect(mine.remove('pair')).toBe(true);
    expect(mine.remove('pair')).toBe(false);
    expect(
      createMyShapes(storage)
        .items()
        .map((i) => i.name),
    ).toEqual(['Pair 2']);
    expect(createMyShapes(memoryStorage({ [MY_SHAPES_KEY]: '{"format":"fluxion-my-shapes"' })).items()).toEqual([]);
    // storage that refuses (full) leaves the items as they were
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };
    const refused = createMyShapes(full);
    expect(refused.put(item)).toBe(false);
    expect(refused.items()).toEqual([]);
  });

  it("FR-LIB-008: an unreadable stored value is set aside before anything is written, never overwritten; another tab's items are kept", () => {
    const a = source();
    const item = saveMyShape(a.core.store, a.picked, { id: 'pair', name: 'Pair' }, SOURCE(a.screen)) as MyShape;
    // a newer version's file: not used, kept aside, then My shapes starts afresh
    const newer = JSON.stringify({ format: 'fluxion-my-shapes', formatVersion: '1.1', items: [item] });
    const storage = memoryStorage({ [MY_SHAPES_KEY]: newer });
    const mine = createMyShapes(storage);
    expect(mine.items()).toEqual([]);
    // opening writes nothing
    expect(storage.map.has(MY_SHAPES_UNREADABLE_KEY)).toBe(false);
    expect(mine.put(item)).toBe(true);
    expect(storage.map.get(MY_SHAPES_UNREADABLE_KEY)).toBe(newer);
    // a second unreadable value while the first is still kept aside: nothing is written, both survive
    storage.map.set(MY_SHAPES_KEY, 'damaged');
    expect(mine.put({ ...item, id: 'pair-2' })).toBe(false);
    expect([storage.map.get(MY_SHAPES_KEY), storage.map.get(MY_SHAPES_UNREADABLE_KEY)]).toEqual(['damaged', newer]);
    // two tabs on one storage: each change starts from what is stored, so neither loses the other's item
    const shared = memoryStorage();
    const [one, two] = [createMyShapes(shared), createMyShapes(shared)];
    one.put(item);
    two.put({ ...item, id: 'pair-2', name: 'Pair 2' });
    expect(two.items().map((i) => i.id)).toEqual(['pair', 'pair-2']);
    expect(
      createMyShapes(shared)
        .items()
        .map((i) => i.id),
    ).toEqual(['pair', 'pair-2']);
  });

  it('FR-LIB-008: removing the last item stores an empty My shapes that reads back and stays writable', () => {
    const a = source();
    const item = saveMyShape(a.core.store, a.picked, { id: 'pair', name: 'Pair' }, SOURCE(a.screen)) as MyShape;
    const kept = 'a value set aside earlier';
    const storage = memoryStorage({ [MY_SHAPES_UNREADABLE_KEY]: kept });
    const mine = createMyShapes(storage);
    expect(mine.put(item)).toBe(true);
    expect(mine.remove('pair')).toBe(true);
    const reopened = createMyShapes(storage);
    expect(reopened.items()).toEqual([]);
    expect(reopened.put(item)).toBe(true);
    expect(reopened.remove('pair')).toBe(true);
    expect(storage.map.get(MY_SHAPES_UNREADABLE_KEY)).toBe(kept);
  });

  it('FR-LIB-008: an item a file could not read back (id, name) is refused on save and put', () => {
    const a = source();
    expect(saveMyShape(a.core.store, a.picked, { id: 'shape:1', name: 'Pair' }, SOURCE(a.screen))).toBeUndefined();
    const item = saveMyShape(a.core.store, a.picked, { id: 'pair', name: 'Pair' }, SOURCE(a.screen)) as MyShape;
    const storage = memoryStorage();
    const mine = createMyShapes(storage);
    expect(mine.put({ ...item, id: 'shape:1' })).toBe(false);
    expect(mine.put({ ...item, id: 'x'.repeat(65) })).toBe(false);
    expect(mine.put({ ...item, name: '  ' })).toBe(false);
    expect(mine.put({ ...item, name: 'n'.repeat(121) })).toBe(false);
    expect(mine.put(item)).toBe(true);
    // every saved item reads back, and its export imports
    expect(createMyShapes(storage).items()).toEqual([item]);
    expect(parseMyShapes(exportMyShapes(mine.items())).ok).toBe(true);
  });

  it('FR-LIB-008: an import is refused whole for a foreign format, a bad record, a binding to nothing, a repeated id or bad bounds', () => {
    const a = source();
    const item = saveMyShape(a.core.store, a.picked, { id: 'pair', name: 'Pair' }, SOURCE(a.screen)) as MyShape;
    const file = (items: unknown[]) => JSON.stringify({ format: 'fluxion-my-shapes', formatVersion: '1.0', items });
    const shape = item.payload.records.find((r) => r.type === 'element') as { id: string };
    const cases: string[] = [
      'not json',
      JSON.stringify({ format: 'other', formatVersion: '1.0', items: [item] }),
      JSON.stringify({ format: 'fluxion-my-shapes', formatVersion: '2.0', items: [item] }),
      file([]),
      file([item, item]),
      file([{ ...item, name: '   ' }]),
      file([{ ...item, payload: { ...item.payload, bounds: { x: 0, y: 0, w: Number.NaN, h: 1 } } }]),
      file([
        {
          ...item,
          payload: {
            ...item.payload,
            records: [
              ...item.payload.records,
              { id: 'Bogus00000000001', type: 'binding', connectorId: shape.id, end: 'source', elementId: 'Missing000000001', anchor: { kind: 'auto' } },
            ],
          },
        },
      ]),
      file([{ ...item, payload: { ...item.payload, records: [{ ...shape, transform: 'big' }] } }]),
      file([{ ...item, payload: { ...item.payload, records: [{ id: 'Doc0000000000001', type: 'document' }] } }]),
    ];
    for (const raw of cases) expect(parseMyShapes(raw).ok, raw.slice(0, 60)).toBe(false);
    const mine = createMyShapes(memoryStorage());
    expect(mine.importFile(file([item, { ...item, id: 'pair' }])).ok).toBe(false);
    expect(mine.items()).toEqual([]);
    expect(parseMyShapes(file([item]))).toEqual({ ok: true, value: [item] });
  });
});
