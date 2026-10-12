import { createCore } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { duplicates, moved, reframed, restored, starts } from './move.js';
import { roundGeom } from './round-geom.js';

function setup() {
  const b = documentBuilder({ seed: 140 });
  const screen = b.screen();
  const a = b.rect(screen, { x: 10, y: 20, w: 30, h: 40, rot: 15 });
  const c = b.rect(screen, { x: 200, y: 20 });
  const bound = b.connect(a, c);
  const free = b.connect({ x: 0, y: 0 }, { x: 50, y: 50 });
  const core = createCore(b.build());
  const group = 'groupmove000001' as RecordId;
  const member = 'membermove00001' as RecordId;
  core.store.transact('group', (tx) => {
    tx.put({ id: group, type: 'element', kind: 'group', screenId: screen, index: 'a8', transform: { x: 0, y: 300, w: 100, h: 100 } } as never);
    tx.put({
      id: member,
      type: 'element',
      kind: 'shape',
      defId: 'basic:rect',
      screenId: screen,
      parentId: group,
      index: 'a0',
      // the member fills its group: a group is the bounds of its members (M8.5)
      transform: { x: 0, y: 300, w: 100, h: 100 },
    } as never);
    tx.patch(free, { route: { type: 'straight', waypoints: [{ x: 25, y: 5 }] } });
  });
  return { core, screen, a, c, bound, free, group, member };
}

describe('moving and duplicating (FR-EDT-005)', () => {
  it('FR-EDT-005: a move takes each element with its members, once, from where it started', () => {
    const { core, a, group, member, bound, free } = setup();
    const from = starts(core.store, [group, a, member, 'missing' as RecordId]);
    expect(from.map((s) => s.id)).toEqual([group, member, a]);
    expect(moved(from, { x: 5, y: -10 })).toEqual([
      { id: group, fields: { transform: { x: 5, y: 290, w: 100, h: 100 }, placement: 'pinned' } },
      { id: member, fields: { transform: { x: 5, y: 290, w: 100, h: 100 }, placement: 'pinned' } },
      // the whole transform is kept: size and turn included
      { id: a, fields: { transform: { x: 15, y: 10, w: 30, h: 40, rot: 15 }, placement: 'pinned' } },
    ]);
    // a free connector moves its ends and waypoints; a bound one follows its ends
    expect(moved(starts(core.store, [free, bound]), { x: 1, y: 2 })).toEqual([
      { id: free, fields: { freeSource: { x: 1, y: 2 }, freeTarget: { x: 51, y: 52 }, route: { type: 'straight', waypoints: [{ x: 26, y: 7 }] } } },
    ]);
    // a record that is no element does not move
    expect(starts(core.store, [(core.store.members('byType', 'screen') as RecordId[])[0] as RecordId])).toEqual([]);
  });

  it('FR-EDT-004: a resized or turned frame carries each record: centres carried, sizes scaled, turns turned', () => {
    const { core, a, group, member, free } = setup();
    const before = { x: 0, y: 300, w: 100, h: 100, rot: 0 };
    // the group doubled rightwards: its member too
    expect(reframed(starts(core.store, [group]), before, { ...before, w: 200 })).toEqual([
      { id: group, fields: { transform: { x: 0, y: 300, w: 200, h: 100, rot: 0 }, placement: 'pinned' } },
      { id: member, fields: { transform: { x: 0, y: 300, w: 200, h: 100, rot: 0 }, placement: 'pinned' } },
    ]);
    // turned a quarter: a's own turn of 15° becomes 105°; free ends are carried too
    const frame = { x: 0, y: 0, w: 100, h: 100, rot: 0 };
    const turned = reframed(starts(core.store, [a, free]), frame, { ...frame, rot: 90 });
    const field = (updates: ReturnType<typeof reframed>, i: number, name: string) => (updates[i] as { fields: Record<string, unknown> }).fields[name];
    expect((field(turned, 0, 'transform') as { rot: number }).rot).toBe(105);
    const freeSource = turned[1]?.fields['freeSource'] as { x: number; y: number };
    expect([+freeSource.x.toFixed(9), +freeSource.y.toFixed(9)]).toEqual([100, 0]);
    expect(turned[1]?.fields['route']).toEqual({ type: 'straight', waypoints: [expect.objectContaining({})] });
    // a turn past a full one comes back within [0, 360); a frame of no size scales nothing
    const round = reframed(starts(core.store, [a]), { ...frame, rot: 300 }, { ...frame, rot: 0 });
    expect((field(round, 0, 'transform') as { rot: number }).rot).toBe(75);
    const flat = { x: 0, y: 0, w: 0, h: 0, rot: 0 };
    const same = field(reframed(starts(core.store, [a]), flat, flat), 0, 'transform') as { w: number; h: number };
    expect([+same.w.toFixed(9), +same.h.toFixed(9)]).toEqual([30, 40]);
    expect(field(turned, 1, 'freeTarget')).toBeDefined();
    // turned a quarter against the frame, a record's own width is the frame's height: stretching the
    // frame twice as wide makes it twice as tall (its own h), not twice as long (M6.15 review F1)
    core.store.transact('upright', (tx) => tx.patch(a, { transform: { x: 0, y: 0, w: 100, h: 20, rot: 90 } }));
    const wide = reframed(starts(core.store, [a]), frame, { ...frame, w: 200 });
    const t = field(wide, 0, 'transform') as { w: number; h: number };
    expect([+t.w.toFixed(9), +t.h.toFixed(9)]).toEqual([100, 40]);
    // one turned element resized in its own frame: its own sides scale as the frame's (a turn of 45°)
    core.store.transact('slant', (tx) => tx.patch(a, { transform: { x: 0, y: 0, w: 100, h: 20, rot: 45 } }));
    const slanted = { x: 0, y: 0, w: 100, h: 20, rot: 45 };
    const own = field(reframed(starts(core.store, [a]), slanted, { ...slanted, w: 200 }), 0, 'transform') as { w: number; h: number };
    expect([+own.w.toFixed(9), +own.h.toFixed(9)]).toEqual([200, 20]);
    // turned a quarter against the frame, the frame made twice as tall doubles its own width
    core.store.transact('upright', (tx) => tx.patch(a, { transform: { x: 0, y: 0, w: 100, h: 20, rot: 90 } }));
    const tall = field(reframed(starts(core.store, [a]), frame, { ...frame, h: 200 }), 0, 'transform') as { w: number; h: number };
    expect([+tall.w.toFixed(9), +tall.h.toFixed(9)]).toEqual([200, 20]);
    // nothing placed: nothing to carry
    const { bound } = setup();
    expect(reframed(starts(core.store, [bound]), frame, frame)).toEqual([]);
  });

  it('FR-EDT-005: duplicates have fresh ids, sit just in front of their originals, keep their copied parent', () => {
    const { core, screen, a, c, group, member, bound } = setup();
    let n = 0;
    const newId = () => `copycopycopy000${++n}` as RecordId;
    const { records, ids } = duplicates(core.store, [group, a, bound], newId);
    // the bound connector is left out; the member's copy sits in the group's copy
    expect(records.map((r) => [r.id, (r as { parentId?: string }).parentId ?? null])).toEqual([
      ['copycopycopy0001', null],
      ['copycopycopy0002', 'copycopycopy0001'],
      ['copycopycopy0003', null],
    ]);
    expect(ids).toEqual(['copycopycopy0001', 'copycopycopy0003']);
    const indexOf = (id: RecordId) => (core.store.get(id) as { index: string }).index;
    const [groupCopy, memberCopy, aCopy] = records as unknown as [{ index: string }, { index: string }, { index: string }];
    // in front of the original, behind the next sibling
    expect(groupCopy.index > indexOf(group)).toBe(true);
    expect(aCopy.index > indexOf(a) && aCopy.index < indexOf(c)).toBe(true);
    // the last sibling: in front of it, with nothing after
    expect(memberCopy.index > indexOf(member)).toBe(true);
    // the copies are valid as they are: createMany takes them
    expect(core.execute('element.createMany', { elements: records }).ok).toBe(true);
    expect(core.store.members('byScreen', screen).length).toBe(9);
    // a slug names one element: a copy has none, and keeps the rest of its semantics
    core.store.transact('slugs', (tx) => {
      tx.patch(a, { semantic: { slug: 'the-a', role: 'hero' } });
      tx.patch(c, { semantic: { slug: 'the-c' } });
    });
    const named = duplicates(core.store, [a, c], newId);
    expect(named.records.map((r) => (r as { semantic?: unknown }).semantic)).toEqual([{ role: 'hero' }, undefined]);
    expect(core.execute('element.createMany', { elements: named.records }).ok).toBe(true);
    // the next sibling by index, not by the order records were added; nested members are not siblings
    const ob = documentBuilder({ seed: 141 });
    const scr = ob.screen();
    const order = createCore(ob.build());
    const box = { x: 0, y: 0, w: 1, h: 1 };
    order.store.transact('order', (tx) => {
      for (const [id, index, parentId] of [
        ['orderorderorder1', 'a1', undefined],
        // listed first by id, but not the next by index
        ['orderorderorderA', 'a9', undefined],
        ['orderorderorderZ', 'a2', undefined],
        ['ordergrouporder', 'a4', undefined],
        // nested: not a sibling of the top-level ones, though its index falls between them
        ['ordermemberordr', 'a1V', 'ordergrouporder'],
      ] as const)
        tx.put({
          id,
          type: 'element',
          kind: id.includes('group') ? 'group' : 'shape',
          defId: 'basic:rect',
          screenId: scr,
          index,
          transform: box,
          ...(parentId && { parentId }),
        } as never);
    });
    const next = duplicates(order.store, ['orderorderorder1' as RecordId, 'missing' as RecordId], () => 'ordercopyorder1' as RecordId);
    expect(next.records.map((r) => (r as { index: string }).index)).toEqual(['a1V']);
    expect(next.ids).toEqual(['ordercopyorder1']);
    // a member copied without its group stays in the group
    const alone = duplicates(core.store, [member], () => 'membercopy00001' as RecordId);
    expect((alone.records[0] as { parentId?: string }).parentId).toBe(group);
  });

  it('FR-EDT-022: a move or resize pins the boxes it moves; restored puts transform and placement back, removing a placement the record did not have', () => {
    const { core, a, free } = setup();
    const from = starts(core.store, [a, free]);
    expect(moved(from, { x: 1, y: 1 })[0]?.fields['placement']).toBe('pinned');
    expect(reframed(from, { x: 0, y: 0, w: 10, h: 10, rot: 0 }, { x: 0, y: 0, w: 20, h: 10, rot: 0 })[0]?.fields['placement']).toBe('pinned');
    // a connector has no box to pin
    expect(moved(starts(core.store, [free]), { x: 1, y: 1 })[0]?.fields).not.toHaveProperty('placement');
    const back = restored(from);
    expect(back[0]).toEqual({ id: a, fields: { transform: expect.objectContaining({ x: 10, y: 20 }), placement: undefined } });
    core.store.transact('pin', (tx) => tx.patch(a, { placement: 'pinned' }));
    expect(restored(starts(core.store, [a]))[0]?.fields['placement']).toBe('pinned');
  });
});

describe('rounding what a gesture writes (FR-EDT-022)', () => {
  it('FR-EDT-022: roundGeom rounds to 2 decimals, half away from zero, never gives -0, and leaves round and large values alone', () => {
    expect([roundGeom(109.99999999999997), roundGeom(99.99997161155522), roundGeom(10.004), roundGeom(9.996)]).toEqual([110, 100, 10, 10]);
    expect([roundGeom(1.005 + 1e-9), roundGeom(0.005), roundGeom(-0.005), roundGeom(-1.234), roundGeom(0.5)]).toEqual([1.01, 0.01, -0.01, -1.23, 0.5]);
    expect(Object.is(roundGeom(-0.001), 0)).toBe(true);
    expect(Object.is(roundGeom(-0), 0)).toBe(true);
    expect([roundGeom(123456789.126), roundGeom(1e15), roundGeom(3, 0), roundGeom(2.5678, 3)]).toEqual([123456789.13, 1e15, 3, 2.568]);
  });

  it('FR-EDT-022: a move by a fractional delta writes positions of 2 decimals: boxes, free ends and waypoints', () => {
    const { core, a, free } = setup();
    const updates = moved(starts(core.store, [a, free]), { x: 10.004, y: 9.996 });
    expect(updates[0]?.fields['transform']).toEqual({ x: 20, y: 30, w: 30, h: 40, rot: 15 });
    expect(updates[1]?.fields).toEqual({
      freeSource: { x: 10, y: 10 },
      freeTarget: { x: 60, y: 60 },
      route: { type: 'straight', waypoints: [{ x: 35, y: 15 }] },
    });
    // float noise in the pointer's delta is gone too
    expect(moved(starts(core.store, [a]), { x: 99.99999999999997 - 90, y: 0.1 + 0.2 }).map((u) => u.fields['transform'])).toEqual([
      { x: 20, y: 20.3, w: 30, h: 40, rot: 15 },
    ]);
  });

  it('FR-EDT-022: a resize or turn by a fractional delta writes sizes, positions and turn of 2 decimals', () => {
    const { core, group } = setup();
    const before = { x: 0, y: 300, w: 100, h: 100, rot: 0 };
    const sized = reframed(starts(core.store, [group]), before, { ...before, w: 100 + 10.004, h: 100 + 9.996 });
    expect(sized[0]?.fields['transform']).toEqual({ x: 0, y: 300, w: 110, h: 110, rot: 0 });
    const third = reframed(starts(core.store, [group]), before, { ...before, w: 100 / 3 });
    expect(third[0]?.fields['transform']).toEqual({ x: 0, y: 300, w: 33.33, h: 100, rot: 0 });
    const turned = reframed(starts(core.store, [group]), before, { ...before, rot: 33.33333333 });
    expect((turned[0]?.fields['transform'] as { rot: number } | undefined)?.rot).toBe(33.33);
    // a turn that rounds up to a full one stays within [0, 360)
    const full = reframed(starts(core.store, [group]), before, { ...before, rot: -0.001 });
    expect((full[0]?.fields['transform'] as { rot: number } | undefined)?.rot).toBe(0);
  });
});
