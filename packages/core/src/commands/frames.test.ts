// FR-ARR-006: frames carry and reparent their children (ADR-0052, M19.10). Members keep screen coordinates: a frame's move moves
// them by the same delta, its resize leaves them, its turn and flip carry them; a drag that ends with an element's centre in a frame
// makes it a member, one that leaves its frame joins the frame's container; each drag, move and reparent, is one undo step.
import type { AnyRecord, DocumentFile, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { dropReparents, frameDropTarget, frameFlipped, frameTurned } from '../arrange/frames.js';
import { createCore } from '../bootstrap.js';

type Box = { x: number; y: number; w: number; h: number; rot: number; flipX?: boolean; flipY?: boolean };
type El = { id: RecordId; kind: string; parentId?: RecordId; index: string; placement?: string; transform: Box };

/** One screen: frame F (100,100 400x300) holding a and b, a rect c outside, a group G holding frame H (holding m) and a rect g. */
function setup(extra: { readonly frame?: Record<string, unknown>; readonly inner?: Record<string, unknown> } = {}) {
  const b = documentBuilder({ seed: 1910 });
  const screen = b.screen();
  const doc = b.build();
  const add = (r: Record<string, unknown>) => {
    (doc.records as Record<string, AnyRecord>)[r['id'] as string] = r as unknown as AnyRecord;
    return r['id'] as RecordId;
  };
  const base = ([id, index, kind]: readonly [string, string, string], t: Box, parentId?: string) => ({
    id,
    type: 'element',
    kind,
    screenId: screen,
    index,
    ...(parentId === undefined ? {} : { parentId }),
    transform: t,
  });
  const shape = (id: string, index: string, t: Box, parentId?: string) => add({ ...base([id, index, 'shape'], t, parentId), defId: 'basic:rect' });
  const frame = add({ ...base(['F', 'a1', 'frame'], { x: 100, y: 100, w: 400, h: 300, rot: 0 }), ...extra.frame });
  const a = shape('a', 'a0', { x: 120, y: 120, w: 80, h: 40, rot: 0 }, frame);
  const bb = shape('b', 'a1', { x: 300, y: 250, w: 60, h: 60, rot: 30 }, frame);
  const c = shape('c', 'a2', { x: 700, y: 100, w: 80, h: 40, rot: 0 });
  const group = add(base(['G', 'a3', 'group'], { x: 700, y: 400, w: 400, h: 300, rot: 0 }));
  const inner = add({ ...base(['H', 'a0', 'frame'], { x: 700, y: 400, w: 200, h: 200, rot: 0 }, group), ...extra.inner });
  const m = shape('m', 'a0', { x: 720, y: 420, w: 40, h: 40, rot: 0 }, inner);
  const g = shape('g', 'a1', { x: 1000, y: 600, w: 100, h: 100, rot: 0 }, group);
  const k = add({
    id: 'k',
    type: 'element',
    kind: 'connector',
    screenId: screen,
    index: 'a4',
    route: { type: 'straight' },
    freeSource: { x: 900, y: 100 },
    freeTarget: { x: 950, y: 150 },
  });
  const core = createCore(doc as DocumentFile);
  const el = (id: RecordId) => core.store.get(id) as unknown as El;
  const update = (updates: readonly { id: RecordId; fields: Record<string, unknown> }[], mergeKey = 'step') =>
    core.execute('element.updateMany', { updates }, { mergeKey });
  /** A pointer drag of `ids` by `d`: the move, then the reparent at the drop, under one merge key (the editor's gesture). */
  const drag = (ids: readonly RecordId[], d: { x: number; y: number }) => {
    const all = [...new Set(ids.flatMap((id) => [id, ...below(id)]))];
    const moves = all
      .filter((id) => el(id).transform !== undefined)
      .map((id) => ({ id, fields: { transform: { ...el(id).transform, x: el(id).transform.x + d.x, y: el(id).transform.y + d.y }, placement: 'pinned' } }));
    if (moves.length > 0) update(moves, 'drag');
    const reparents = dropReparents(core.store, ids);
    if (reparents.length > 0) update(reparents, 'drag');
    core.store.history.seal();
    return reparents;
  };
  const below = (id: RecordId): RecordId[] => core.store.members('byParent', id).flatMap((x) => [x, ...below(x)]);
  return { core, screen, el, update, drag, frame, a, b: bb, c, group, inner, m, g, k };
}

const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9;

describe('frames carry their members (FR-ARR-006, ADR-0052)', () => {
  it('FR-ARR-006: a frame move carries its members by the same delta, in one undo step', () => {
    const s = setup();
    const before = [s.frame, s.a, s.b].map((id) => s.el(id).transform);
    expect(s.core.execute('element.align', { ids: [s.frame], mode: 'left', to: 'screen' }).ok).toBe(true);
    const after = [s.frame, s.a, s.b].map((id) => s.el(id).transform);
    const dx = (after[0]?.x ?? 0) - (before[0]?.x ?? 0);
    expect(dx).toBe(-100);
    for (const [i, t] of after.entries()) expect([t.x - (before[i]?.x ?? 0), t.y - (before[i]?.y ?? 0)]).toEqual([dx, 0]);
    expect(s.core.store.history.undo().ok).toBe(true);
    expect([s.frame, s.a, s.b].map((id) => s.el(id).transform)).toEqual(before);
  });

  it('FR-ARR-006: a frame resize leaves members unchanged and the frame box as written (it is never refitted to them)', () => {
    const s = setup();
    const members = [s.a, s.b].map((id) => s.el(id).transform);
    expect(s.update([{ id: s.frame, fields: { transform: { x: 100, y: 100, w: 150, h: 100, rot: 0 } } }]).ok).toBe(true);
    expect(s.el(s.frame).transform).toEqual({ x: 100, y: 100, w: 150, h: 100, rot: 0 });
    expect([s.a, s.b].map((id) => s.el(id).transform)).toEqual(members);
    // a frame inside a group: the group refits to the frame's box, not to the frame's members
    expect(s.update([{ id: s.inner, fields: { transform: { x: 700, y: 400, w: 20, h: 20, rot: 0 } } }]).ok).toBe(true);
    expect(s.el(s.group).transform).toMatchObject({ x: 700, y: 400, w: 400, h: 300 });
  });

  it('FR-ARR-006: turn and flip carry members: a member turned 30° in a horizontally flipped frame ends at 330° with flipX toggled', () => {
    const s = setup();
    const turned = frameTurned(s.core.store, s.frame, 90);
    expect(turned.map((u) => u.id)).toEqual([s.frame, s.a, s.b]);
    expect(s.update(turned).ok).toBe(true);
    // a's centre (160, 140) about the frame's centre (300, 250), turned 90°: (410, 110)
    const a = s.el(s.a).transform;
    expect([a.x + a.w / 2, a.y + a.h / 2].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([410, 110]);
    expect([s.el(s.frame).transform.rot, a.rot, s.el(s.b).transform.rot]).toEqual([90, 90, 120]);
    expect(s.core.store.history.undo().ok).toBe(true);
    expect(s.update(frameFlipped(s.core.store, s.frame, 'x')).ok).toBe(true);
    const b = s.el(s.b).transform;
    expect(b).toMatchObject({ rot: 330, flipX: true });
    // b's centre (330, 280) mirrored across x = 300
    expect([b.x + b.w / 2, b.y + b.h / 2].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([270, 280]);
    expect(s.el(s.frame).transform).toMatchObject({ x: 100, rot: 0, flipX: true });
    // a vertical flip toggles flipY and mirrors across y = 250
    expect(s.update(frameFlipped(s.core.store, s.frame, 'y')).ok).toBe(true);
    expect(s.el(s.b).transform).toMatchObject({ rot: 30, flipX: true, flipY: true });
  });

  it('FR-ARR-006: flipping a turned frame (φ) maps a member rot θ to 2φ − θ and mirrors it across the turned centre line', () => {
    const s = setup({ frame: { transform: { x: 100, y: 100, w: 400, h: 300, rot: 20 } } });
    expect(s.update(frameFlipped(s.core.store, s.frame, 'x')).ok).toBe(true);
    expect(s.el(s.frame).transform).toMatchObject({ rot: 20, flipX: true });
    expect(s.el(s.b).transform.rot).toBe(10);
    expect(s.el(s.a).transform.rot).toBe(40);
    // the mirror is an involution: flipping again restores every member's box
    const once = [s.a, s.b].map((id) => s.el(id).transform);
    expect(s.update(frameFlipped(s.core.store, s.frame, 'x')).ok).toBe(true);
    const twice = [s.a, s.b].map((id) => s.el(id).transform);
    const original = setup({ frame: { transform: { x: 100, y: 100, w: 400, h: 300, rot: 20 } } });
    for (const [i, t] of twice.entries()) {
      const o = original.el([original.a, original.b][i] as RecordId).transform;
      expect([near(t.x, o.x), near(t.y, o.y), t.rot, Boolean(t.flipX)]).toEqual([true, true, o.rot, false]);
    }
    expect(once[0]?.flipX).toBe(true);
  });
});

describe('drop to reparent (FR-ARR-006, ADR-0052)', () => {
  it('FR-ARR-006: a shape dropped with its centre inside a frame joins it above its members, and one undo puts both back', () => {
    const s = setup();
    const before = s.el(s.c);
    expect(s.drag([s.c], { x: -400, y: 100 })).toEqual([{ id: s.c, fields: { parentId: s.frame, index: expect.any(String) } }]);
    const joined = s.el(s.c);
    expect(joined.parentId).toBe(s.frame);
    expect(joined.index > s.el(s.b).index).toBe(true);
    expect(joined.placement).toBe('pinned');
    expect(s.core.store.history.undo().ok).toBe(true);
    expect(s.el(s.c)).toEqual(before);
  });

  it('FR-ARR-006: a member whose centre leaves its frame joins the screen; a drag that stays inside changes no membership', () => {
    const s = setup();
    expect(s.drag([s.a], { x: 10, y: 10 })).toEqual([]);
    expect(s.drag([s.a], { x: -300, y: 0 })).toEqual([{ id: s.a, fields: { parentId: undefined, index: expect.any(String) } }]);
    expect(s.el(s.a).parentId).toBeUndefined();
  });

  it('FR-ARR-006: a drop into a live frame adopts the element as auto, so its layout places it', () => {
    const s = setup({ frame: { layout: { type: 'stack', live: true } } });
    s.drag([s.c], { x: -400, y: 100 });
    expect(s.el(s.c)).toMatchObject({ parentId: s.frame, placement: 'auto' });
  });

  it('FR-ARR-006: a hidden frame is never a drop target, nor is a frame inside a hidden container', () => {
    const s = setup({ frame: { hidden: true } });
    expect(frameDropTarget(s.core.store, s.screen, { x: 300, y: 250 }, new Set())).toBeUndefined();
    expect(s.drag([s.c], { x: -400, y: 100 })).toEqual([]);
    const t = setup();
    expect(t.update([{ id: t.group, fields: { hidden: true } }]).ok).toBe(true);
    expect(frameDropTarget(t.core.store, t.screen, { x: 800, y: 500 }, new Set())).toBeUndefined();
  });

  it('FR-ARR-006: a member dragged out of a frame that sits inside a group leaves the frame and joins the group, staying a group member', () => {
    const s = setup();
    s.drag([s.m], { x: 300, y: 0 });
    expect(s.el(s.m).parentId).toBe(s.group);
    // a member of a group dragged alone stays in its group, even dropped over a frame
    s.drag([s.g], { x: -700, y: -400 });
    expect(s.el(s.g).parentId).toBe(s.group);
    // the whole group dragged into a frame joins it
    s.drag([s.group], { x: -580, y: -280 });
    expect(s.el(s.group).parentId).toBe(s.frame);
  });

  it('FR-ARR-006: the deepest frame under the centre takes the drop, never the dragged frame or one inside it, and a connector stays', () => {
    const s = setup();
    // H sits in G, drawn over by nothing: a point in H is H's
    expect(frameDropTarget(s.core.store, s.screen, { x: 800, y: 500 }, new Set())).toBe(s.inner);
    expect(frameDropTarget(s.core.store, s.screen, { x: 800, y: 500 }, new Set([s.inner]))).toBeUndefined();
    // dragging F onto H: F joins H, its members ride along and stay F's
    s.drag([s.frame], { x: 550, y: 350 });
    expect([s.el(s.frame).parentId, s.el(s.a).parentId]).toEqual([s.inner, s.frame]);
    // a free connector dragged over a frame stays where it is in the tree
    expect(s.drag([s.k], { x: -700, y: 100 })).toEqual([]);
    expect(s.el(s.k).parentId).toBeUndefined();
  });

  it('FR-ARR-006: a property test: random drags that reparent, each undone, restore the store exactly', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            who: fc.constantFrom('a', 'b', 'c', 'm', 'g', 'F', 'G', 'H'),
            dx: fc.integer({ min: -900, max: 900 }),
            dy: fc.integer({ min: -600, max: 600 }),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        (steps) => {
          const s = setup();
          const snapshot = () =>
            JSON.stringify(
              s.core.store
                .ids()
                .sort()
                .map((id) => s.core.store.get(id)),
            );
          const states = [snapshot()];
          for (const step of steps) {
            s.drag([step.who as RecordId], { x: step.dx, y: step.dy });
            states.push(snapshot());
          }
          for (let i = steps.length - 1; i >= 0; i--) {
            expect(s.core.store.history.undo().ok).toBe(true);
            expect(snapshot()).toBe(states[i]);
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});
