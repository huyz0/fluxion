import { elementBounds } from '@fluxion/geometry';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { registerCoreCommands } from '../builtin-commands.js';
import { type AnyCommand, executeCommand } from '../commands.js';
import { type IntegrityHook, registerCoreHooks } from '../hooks.js';
import { createRegistry } from '../registry.js';
import { RecordStore } from '../store.js';
import { distributeDeltas } from './distribute.js';

type T = { x: number; y: number; w: number; h: number; rot?: number };

/** A store of rects at `placements` (rotations included) on one screen, and the command runner. */
function setup(placements: readonly T[]) {
  const b = documentBuilder({ seed: 90 });
  const screen = b.screen({ size: { w: 4000, h: 4000 } });
  const ids = placements.map((p) => b.rect(screen, p));
  const hooks = createRegistry<string, IntegrityHook>('integrityHooks');
  registerCoreHooks(hooks);
  const store = new RecordStore(b.build(), { hooks });
  const commands = createRegistry<string, AnyCommand>('commands');
  registerCoreCommands(commands);
  const run = (id: string, args: unknown) => executeCommand(commands, { store }, id, args);
  const bounds = (id: RecordId) => elementBounds({ rot: 0, ...(store.get(id) as unknown as { transform: T }).transform });
  return { store, run, ids, bounds };
}

const place = fc.record({
  x: fc.integer({ min: 0, max: 2000 }),
  y: fc.integer({ min: 0, max: 2000 }),
  w: fc.integer({ min: 10, max: 200 }),
  h: fc.integer({ min: 10, max: 200 }),
  rot: fc.integer({ min: 0, max: 359 }),
});

describe('distribute (FR-ARR-003)', () => {
  it('FR-ARR-003: distribute leaves equal gaps within 1e-6', () => {
    fc.assert(
      fc.property(fc.array(place, { minLength: 3, maxLength: 8 }), fc.constantFrom('horizontal', 'vertical'), (placements, axis) => {
        const { run, ids, bounds } = setup(placements);
        const before = ids.map(bounds);
        expect(run('element.distribute', { ids, axis, by: 'gaps' }).ok).toBe(true);
        const [pos, size] = axis === 'horizontal' ? (['x', 'w'] as const) : (['y', 'h'] as const);
        // in the order they had along the axis (the command keeps it; overlapping boxes could swap if sorted again)
        const order = ids
          .map((_, i) => i)
          .sort(
            (i, j) =>
              (before[i] as (typeof before)[number])[pos] - (before[j] as (typeof before)[number])[pos] ||
              (before[i] as (typeof before)[number])[size] - (before[j] as (typeof before)[number])[size] ||
              i - j,
          );
        const after = order.map((i) => bounds(ids[i] as RecordId));
        const gaps = after.slice(1).map((b, i) => b[pos] - ((after[i] as (typeof after)[number])[pos] + (after[i] as (typeof after)[number])[size]));
        for (const g of gaps) expect(Math.abs(g - (gaps[0] as number))).toBeLessThan(1e-6);
        // the outer two (by position) stay put
        const [firstId, lastId] = [order[0] as number, order[order.length - 1] as number];
        expect(after[0]?.[pos]).toBeCloseTo((before[firstId] as (typeof before)[number])[pos], 6);
        const lastBefore = before[lastId] as (typeof before)[number];
        const lastAfter = after[after.length - 1] as (typeof after)[number];
        expect(lastAfter[pos]).toBeCloseTo(lastBefore[pos], 6);
      }),
      { numRuns: 100 },
    );
  });

  it('FR-ARR-003: distributing by centres spaces the centres equally, the outer two staying', () => {
    const { run, ids, bounds } = setup([
      { x: 0, y: 0, w: 100, h: 50 },
      { x: 150, y: 100, w: 20, h: 50 },
      { x: 180, y: 200, w: 300, h: 50 },
      { x: 700, y: 300, w: 100, h: 50 },
    ]);
    expect(run('element.distribute', { ids, axis: 'horizontal', by: 'centers' }).ok).toBe(true);
    const centres = ids.map((i) => bounds(i).x + bounds(i).w / 2);
    expect(centres).toEqual([50, expect.closeTo(50 + 700 / 3, 6), expect.closeTo(50 + 1400 / 3, 6), 750]);
    // the other axis did not move
    expect(ids.map((i) => bounds(i).y)).toEqual([0, 100, 200, 300]);
  });

  it('FR-ARR-003: a fixed gap lays the elements out from the first, in order, with that spacing', () => {
    const { run, ids, bounds } = setup([
      { x: 500, y: 0, w: 100, h: 50 },
      { x: 0, y: 0, w: 40, h: 50 },
      { x: 90, y: 0, w: 60, h: 50 },
    ]);
    expect(run('element.distribute', { ids, axis: 'horizontal', by: 'gaps', gap: 10 }).ok).toBe(true);
    // left to right: the 40 wide one stays at 0, then 10, then the 60 wide one, 10, then the 100 wide one
    expect(ids.map((i) => bounds(i).x)).toEqual([120, 0, 50]);
    // two elements are enough when the gap is given
    const two = setup([
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 500, y: 0, w: 10, h: 10 },
    ]);
    expect(two.run('element.distribute', { ids: two.ids, axis: 'horizontal', by: 'gaps', gap: 5 }).ok).toBe(true);
    expect(two.ids.map((i) => two.bounds(i).x)).toEqual([0, 15]);
  });

  it('FR-ARR-003: distributeDeltas is the shift along the axis of each box, none for fewer than three without a gap', () => {
    const boxes = [
      { id: 'a', box: { x: 0, y: 0, w: 10, h: 10 } },
      { id: 'b', box: { x: 20, y: 0, w: 10, h: 10 } },
      { id: 'c', box: { x: 100, y: 0, w: 10, h: 10 } },
    ];
    expect([...(distributeDeltas(boxes, 'horizontal', 'gaps') ?? new Map())]).toEqual([
      ['a', 0],
      ['b', 30],
      ['c', 0],
    ]);
    // boxes starting at the same place: the smaller one first, so the result does not depend on the order they were listed in
    const tied = [
      { id: 'big', box: { x: 0, y: 0, w: 100, h: 10 } },
      { id: 'small', box: { x: 0, y: 0, w: 10, h: 10 } },
      { id: 'far', box: { x: 300, y: 0, w: 10, h: 10 } },
    ];
    expect([...(distributeDeltas(tied, 'horizontal', 'gaps') ?? new Map())]).toEqual([
      ['small', 0],
      ['big', 105],
      ['far', 0],
    ]);
    expect(distributeDeltas(boxes.slice(0, 2), 'horizontal', 'gaps')).toBeUndefined();
    expect(distributeDeltas(boxes.slice(0, 2), 'horizontal', 'gaps', 5)).toBeDefined();
  });

  it('FR-ARR-003: distribute moves groups with their members, is one undo step, and refuses what it cannot space', () => {
    const { run, ids, store, bounds } = setup([
      { x: 0, y: 0, w: 50, h: 50 },
      { x: 60, y: 0, w: 50, h: 50 },
      { x: 120, y: 0, w: 50, h: 50 },
      { x: 600, y: 0, w: 50, h: 50 },
    ]);
    expect(run('element.group', { ids: [ids[1], ids[2]], groupId: 'mid' }).ok).toBe(true);
    const before = ids.map(bounds);
    const steps = store.history.canUndo();
    // three things in a row: the first rect, the group of two, the last rect
    expect(run('element.distribute', { ids: [ids[0], 'mid', ids[3]], axis: 'horizontal', by: 'gaps' }).ok).toBe(true);
    const g = store.get('mid' as RecordId) as unknown as { transform: T };
    const [a, last] = [bounds(ids[0] as RecordId), bounds(ids[3] as RecordId)];
    expect(g.transform.x - (a.x + a.w)).toBeCloseTo(last.x - (g.transform.x + g.transform.w), 6);
    // the group's members moved together
    expect(bounds(ids[2] as RecordId).x - bounds(ids[1] as RecordId).x).toBeCloseTo((before[2] as T).x - (before[1] as T).x, 6);
    store.history.undo();
    expect(ids.map(bounds)).toEqual(before);
    expect(store.history.canUndo()).toBe(steps);
    const code = (r: { ok: boolean; error?: { code: string } }) => (r.ok ? 'ok' : r.error?.code);
    expect(code(run('element.distribute', { ids: [ids[0], ids[1]], axis: 'horizontal', by: 'gaps' }))).toBe('COMMAND_ARGS');
    expect(code(run('element.distribute', { ids: ['nope', ids[0], ids[1]], axis: 'horizontal', by: 'gaps' }))).toBe('COMMAND_ARGS');
    // a repeated id is one element, not two: A, A, B is two elements and cannot be spaced evenly
    expect(code(run('element.distribute', { ids: [ids[0], ids[0], ids[3]], axis: 'horizontal', by: 'gaps' }))).toBe('COMMAND_ARGS');
    expect(ids.map(bounds)).toEqual(before);
  });

  it('FR-ARR-003: elements of two screens are not spaced against each other', () => {
    const b = documentBuilder({ seed: 91 });
    const [s1, s2] = [b.screen(), b.screen()];
    const ids = [b.rect(s1), b.rect(s1, { x: 200 }), b.rect(s2, { x: 400 })];
    const hooks = createRegistry<string, IntegrityHook>('integrityHooks');
    registerCoreHooks(hooks);
    const store = new RecordStore(b.build(), { hooks });
    const commands = createRegistry<string, AnyCommand>('commands');
    registerCoreCommands(commands);
    const r = executeCommand(commands, { store }, 'element.distribute', { ids, axis: 'horizontal', by: 'gaps' });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.code).toBe('COMMAND_ARGS');
  });
});
