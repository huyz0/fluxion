// FR-ARR-007: match size (M19.12). Each element takes the key's width, height or both, its top-left corner staying; a group's
// members scale with it about that corner; a frame changes its box alone (ADR-0052); one undo step restores everything.
import type { AnyRecord, DocumentFile, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { createCore } from '../bootstrap.js';

type Box = { x: number; y: number; w: number; h: number; rot: number };

/** Key k (200x100), rects a and b, a group G (a member p and a free connector q), a frame F holding m, a connector c with no box. */
function setup() {
  const b = documentBuilder({ seed: 1912 });
  const screen = b.screen();
  const doc = b.build();
  const add = (id: string, index: string, kind: string, fields: Record<string, unknown>) => {
    (doc.records as Record<string, AnyRecord>)[id] = { id, type: 'element', kind, screenId: screen, index, ...fields } as unknown as AnyRecord;
    return id as RecordId;
  };
  const box = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h, rot: 0 });
  const k = add('k', 'a0', 'shape', { defId: 'basic:rect', transform: box(0, 0, 200, 100) });
  const a = add('a', 'a1', 'shape', { defId: 'basic:rect', transform: box(300, 0, 50, 40) });
  const r = add('r', 'a2', 'shape', { defId: 'basic:rect', transform: { ...box(400, 0, 60, 60), rot: 30 } });
  const g = add('G', 'a3', 'group', { transform: box(0, 300, 100, 50) });
  const p = add('p', 'a0', 'shape', { defId: 'basic:rect', parentId: g, placement: 'auto', transform: box(0, 300, 100, 50) });
  const q = add('q', 'a1', 'connector', { parentId: g, route: { type: 'straight' }, freeSource: { x: 0, y: 300 }, freeTarget: { x: 100, y: 350 } });
  const f = add('F', 'a4', 'frame', { transform: box(500, 300, 100, 100) });
  const m = add('m', 'a0', 'shape', { defId: 'basic:rect', parentId: f, transform: box(560, 360, 40, 40) });
  const c = add('c', 'a5', 'connector', { route: { type: 'straight' }, freeSource: { x: 0, y: 900 }, freeTarget: { x: 50, y: 950 } });
  const core = createCore(doc as DocumentFile);
  const t = (id: RecordId) => (core.store.get(id) as unknown as { transform: Box }).transform;
  const at = (id: RecordId) => core.store.get(id) as unknown as Record<string, unknown>;
  return { core, k, a, r, g, p, q, f, m, c, t, at };
}

describe('element.matchSize (FR-ARR-007)', () => {
  it("FR-ARR-007: width, height and both give each element the key's dimension, its top-left corner and turn kept, in one undo step", () => {
    const { core, k, a, r, t } = setup();
    expect(core.execute('element.matchSize', { ids: [a, r, k], key: k, mode: 'width' }).ok).toBe(true);
    expect([t(a), t(r), t(k)]).toEqual([
      { x: 300, y: 0, w: 200, h: 40, rot: 0 },
      { x: 400, y: 0, w: 200, h: 60, rot: 30 },
      { x: 0, y: 0, w: 200, h: 100, rot: 0 },
    ]);
    expect(core.execute('element.matchSize', { ids: [a], key: k, mode: 'height' }).ok).toBe(true);
    expect(t(a)).toEqual({ x: 300, y: 0, w: 200, h: 100, rot: 0 });
    core.store.history.undo();
    expect(t(a)).toEqual({ x: 300, y: 0, w: 200, h: 40, rot: 0 });
    core.store.history.undo();
    expect([t(a), t(r)]).toEqual([
      { x: 300, y: 0, w: 50, h: 40, rot: 0 },
      { x: 400, y: 0, w: 60, h: 60, rot: 30 },
    ]);
    expect(core.execute('element.matchSize', { ids: [a, r], key: k, mode: 'both' }).ok).toBe(true);
    expect([t(a), t(r)]).toEqual([
      { x: 300, y: 0, w: 200, h: 100, rot: 0 },
      { x: 400, y: 0, w: 200, h: 100, rot: 30 },
    ]);
    expect(core.store.history.undoDepth).toBe(1);
  });

  it("FR-ARR-007: a group scales its members (a connector's free ends too) about its corner; a frame changes its box alone", () => {
    const { core, k, g, p, q, f, m, t, at } = setup();
    expect(core.execute('element.matchSize', { ids: [g, f], key: k, mode: 'both' }).ok).toBe(true);
    // the group 100x50 → 200x100: twice each way about (0, 300); the group-bounds hook refits it to its members
    expect(t(p)).toMatchObject({ x: 0, y: 300, w: 200, h: 100 });
    // a member sized by hand is pinned, as a move pins it (ADR-0031); a connector has no placement to pin
    expect([at(p)['placement'], at(q)['placement']]).toEqual(['pinned', undefined]);
    expect([at(q)['freeSource'], at(q)['freeTarget']]).toEqual([
      { x: 0, y: 300 },
      { x: 200, y: 400 },
    ]);
    expect(t(g)).toMatchObject({ x: 0, y: 300, w: 200, h: 100 });
    expect([t(f), t(m)]).toEqual([
      { x: 500, y: 300, w: 200, h: 100, rot: 0 },
      { x: 560, y: 360, w: 40, h: 40, rot: 0 },
    ]);
  });

  it('FR-ARR-007: a turned member of a group stretches along its own axes, so the group takes the key size', () => {
    const { core, k, g, p, t } = setup();
    // p turned a quarter draws 50 wide and 100 tall: the group refits to that, and match size makes it the key's 200 x 100
    core.store.transact('turn', (tx) => tx.patch(p, { transform: { x: -25, y: 325, w: 100, h: 50, rot: 90 } }));
    const near = (b: Box) => [b.x, b.y, b.w, b.h].map((n) => Math.round(n * 1e9) / 1e9);
    expect(near(t(g))).toEqual([0, 300, 50, 100]);
    expect(core.execute('element.matchSize', { ids: [g], key: k, mode: 'width' }).ok).toBe(true);
    expect([...near(t(p)).slice(2), t(p).rot]).toEqual([100, 200, 90]);
    expect(near(t(g))).toEqual([0, 300, 200, 100]);
  });

  it('FR-ARR-007: a key or element that is no element, a key without a box, or nothing left to size is refused and changes nothing', () => {
    const { core, k, a, c } = setup();
    const before = core.store.history.undoDepth;
    for (const args of [
      { ids: [a], key: 'nope', mode: 'both' },
      { ids: ['nope'], key: k, mode: 'both' },
      { ids: [a], key: c, mode: 'both' },
      { ids: [k, c], key: k, mode: 'both' },
      { ids: [a], key: k, mode: 'diagonal' },
    ])
      expect(core.execute('element.matchSize', args).ok).toBe(false);
    expect(core.store.history.undoDepth).toBe(before);
  });
});
