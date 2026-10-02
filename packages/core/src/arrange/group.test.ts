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

type Placement = { x: number; y: number; w: number; h: number; rot: number };
type El = { id: RecordId; kind: string; parentId?: RecordId; index: string; transform: Placement };

/** A store with `placements` as rects on one screen (in order), the core hooks and the built-in commands. */
function setup(placements: readonly Placement[]) {
  const b = documentBuilder({ seed: 81 });
  const screen = b.screen();
  const rects = placements.map((t) => b.rect(screen, { x: t.x, y: t.y, w: t.w, h: t.h, rot: t.rot }));
  const hooks = createRegistry<string, IntegrityHook>('integrityHooks');
  registerCoreHooks(hooks);
  const store = new RecordStore(b.build(), { hooks });
  const commands = createRegistry<string, AnyCommand>('commands');
  registerCoreCommands(commands);
  const run = (id: string, args: unknown) => executeCommand(commands, { store }, id, args);
  const el = (id: RecordId) => store.get(id) as unknown as El;
  return { store, run, screen, rects, el };
}

const place = fc.record({
  x: fc.integer({ min: -500, max: 500 }),
  y: fc.integer({ min: -500, max: 500 }),
  w: fc.integer({ min: 10, max: 300 }),
  h: fc.integer({ min: 10, max: 300 }),
  rot: fc.integer({ min: -360, max: 360 }),
});
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6;

describe('group and ungroup (FR-ARR-001)', () => {
  it('FR-ARR-001: group then ungroup restores every child world box within 1e-6', () => {
    fc.assert(
      fc.property(fc.array(place, { minLength: 2, maxLength: 6 }), fc.nat(), fc.nat(), (placements, a, b) => {
        const { run, rects, el, store } = setup(placements);
        const worldBox = (id: RecordId) => elementBounds(el(id).transform);
        const before = rects.map(worldBox);
        const order = [...rects].sort((x, y) => (el(x).index < el(y).index ? -1 : 1));
        // an inner group of a prefix of the shapes, then an outer group of it and the rest: nested rotated groups
        const cut = 1 + (a % (rects.length - 1));
        const inner = 'inner' as RecordId;
        const outer = 'outer' as RecordId;
        expect(run('element.group', { ids: order.slice(0, cut), groupId: inner }).ok).toBe(true);
        const rest = [inner, ...order.slice(cut)];
        if (b % 2 === 0) expect(run('element.group', { ids: rest, groupId: outer }).ok).toBe(true);
        // every shape is still where it was, however deep it is nested
        expect(rects.map(worldBox).every((box, i) => (['x', 'y', 'w', 'h'] as const).every((k) => near(box[k], (before[i] as typeof box)[k])))).toBe(true);
        if (b % 2 === 0) expect(run('element.ungroup', { ids: [outer] }).ok).toBe(true);
        expect(run('element.ungroup', { ids: [inner] }).ok).toBe(true);
        for (const [i, id] of rects.entries()) {
          const box = worldBox(id);
          const was = before[i] as typeof box;
          expect((['x', 'y', 'w', 'h'] as const).every((k) => near(box[k], was[k]))).toBe(true);
          expect(el(id).parentId).toBeUndefined();
        }
        // the groups are gone and the shapes keep their relative z-order
        expect(store.get(inner)).toBeUndefined();
        expect(store.get(outer)).toBeUndefined();
        const after = [...rects].sort((x, y) => (el(x).index < el(y).index ? -1 : 1));
        expect(after).toEqual(order);
      }),
      { numRuns: 200 },
    );
  });

  it('FR-ARR-001: a group is the bounds of its members, sits just above the topmost, and is one undo step', () => {
    const { run, rects, el, store } = setup([
      { x: 0, y: 0, w: 100, h: 50, rot: 0 },
      { x: 300, y: 200, w: 100, h: 100, rot: 0 },
      { x: 700, y: 0, w: 10, h: 10, rot: 0 },
    ]);
    const [a, b, c] = rects as [RecordId, RecordId, RecordId];
    const steps = store.history.canUndo();
    expect(run('element.group', { ids: [a, b], groupId: 'g', name: 'Pair' }).ok).toBe(true);
    const g = el('g' as RecordId);
    expect(g).toMatchObject({ kind: 'group', name: 'Pair', transform: { x: 0, y: 0, w: 400, h: 300, rot: 0 } });
    expect([el(a).parentId, el(b).parentId, el(c).parentId]).toEqual(['g', 'g', undefined]);
    // above its topmost member, below the shape that was above it
    expect(g.index > el(b).index && g.index < el(c).index).toBe(true);
    expect(store.history.canUndo()).toBe(true);
    store.history.undo();
    expect(store.get('g' as RecordId)).toBeUndefined();
    expect(el(a).parentId).toBeUndefined();
    expect(store.history.canUndo()).toBe(steps);
  });

  it('FR-ARR-001: grouping refuses what has no sensible group', () => {
    const { run, rects, screen } = setup([
      { x: 0, y: 0, w: 10, h: 10, rot: 0 },
      { x: 20, y: 0, w: 10, h: 10, rot: 0 },
    ]);
    const [a, b] = rects as [RecordId, RecordId];
    const code = (r: { ok: boolean; error?: { code: string } }) => (r.ok ? 'ok' : r.error?.code);
    expect(code(run('element.group', { ids: ['nope'], groupId: 'g' }))).toBe('COMMAND_ARGS');
    expect(code(run('element.group', { ids: [a], groupId: a }))).toBe('COMMAND_ARGS');
    expect(code(run('element.group', { ids: [a, a], groupId: 'g' }))).toBe('COMMAND_ARGS');
    expect(code(run('element.group', { ids: [a, b], groupId: screen }))).toBe('COMMAND_ARGS');
    // elements of different parents are not siblings
    expect(run('element.group', { ids: [a], groupId: 'g1' }).ok).toBe(true);
    expect(code(run('element.group', { ids: ['g1', b, a], groupId: 'g2' }))).toBe('COMMAND_ARGS');
    expect(code(run('element.group', { ids: [a, b], groupId: 'g3' }))).toBe('COMMAND_ARGS');
  });

  it('FR-ARR-001: a connector can be grouped with its shapes and stays bound; a group of connectors alone has no box', () => {
    const b = documentBuilder({ seed: 82 });
    const s = b.screen();
    const [p, q] = [b.rect(s), b.rect(s, { x: 300 })];
    const line = b.connect(p, q);
    const hooks = createRegistry<string, IntegrityHook>('integrityHooks');
    registerCoreHooks(hooks);
    const store = new RecordStore(b.build(), { hooks });
    const commands = createRegistry<string, AnyCommand>('commands');
    registerCoreCommands(commands);
    const run = (id: string, args: unknown) => executeCommand(commands, { store }, id, args);
    const bindings = () => store.members('bindingsByElement', line).length;
    expect(run('element.group', { ids: [line], groupId: 'only' }).ok).toBe(false);
    expect(run('element.group', { ids: [p, q, line], groupId: 'g' }).ok).toBe(true);
    expect(bindings()).toBe(2);
    expect((store.get(line) as unknown as El).parentId).toBe('g');
    expect(run('element.ungroup', { ids: ['g'] }).ok).toBe(true);
    expect(bindings()).toBe(2);
  });

  it('FR-ARR-001: ungroup refuses what is not a group, and a group together with one inside it', () => {
    const { run, rects } = setup([
      { x: 0, y: 0, w: 10, h: 10, rot: 0 },
      { x: 20, y: 0, w: 10, h: 10, rot: 0 },
    ]);
    const [a, b] = rects as [RecordId, RecordId];
    expect(run('element.ungroup', { ids: [a] }).ok).toBe(false);
    expect(run('element.group', { ids: [a], groupId: 'in' }).ok).toBe(true);
    expect(run('element.group', { ids: ['in', b], groupId: 'out' }).ok).toBe(true);
    const together = run('element.ungroup', { ids: ['out', 'in'] });
    expect(together.ok).toBe(false);
    // one level at a time works, an empty group just goes
    expect(run('element.ungroup', { ids: ['out'] }).ok).toBe(true);
    expect(run('element.ungroup', { ids: ['in'] }).ok).toBe(true);
    expect(run('element.group', { ids: [a], groupId: 'solo' }).ok).toBe(true);
    expect(run('element.ungroup', { ids: ['solo'] }).ok).toBe(true);
  });

  it('FR-ARR-001: grouping and ungrouping inside a group work at that level, in the right z-order among its siblings', () => {
    const { run, rects, el } = setup(Array.from({ length: 6 }, (_, i) => ({ x: i * 40, y: 0, w: 30, h: 30, rot: 0 })));
    const [r0, r1, r2, r3, r4, r5] = rects as [RecordId, RecordId, RecordId, RecordId, RecordId, RecordId];
    const above = (x: RecordId, y: RecordId) => el(x).index > el(y).index;
    // everything in an outer group, then r1 and r2 (r0 below, r3-r5 above) in an inner one
    expect(run('element.group', { ids: rects, groupId: 'outer' }).ok).toBe(true);
    expect(run('element.group', { ids: [r1, r2], groupId: 'inner' }).ok).toBe(true);
    expect(el('inner' as RecordId).parentId).toBe('outer');
    expect([el(r0).parentId, el(r3).parentId, el(r1).parentId]).toEqual(['outer', 'outer', 'inner']);
    // the inner group sits just above r2, below r3
    expect(above('inner' as RecordId, r2) && above(r3, 'inner' as RecordId) && above('inner' as RecordId, r0)).toBe(true);
    expect(run('element.ungroup', { ids: ['inner'] }).ok).toBe(true);
    // the members come back into the outer group, between r0 and r3, in their own order
    expect([el(r1).parentId, el(r2).parentId]).toEqual(['outer', 'outer']);
    expect(above(r1, r0) && above(r2, r1) && above(r3, r2) && above(r4, r3) && above(r5, r4)).toBe(true);
    // ungrouping the outer group lifts all six to the screen root, still in order
    expect(run('element.ungroup', { ids: ['outer'] }).ok).toBe(true);
    expect(rects.map((x) => el(x).parentId)).toEqual(Array(6).fill(undefined));
    expect(above(r1, r0) && above(r2, r1) && above(r3, r2) && above(r4, r3) && above(r5, r4)).toBe(true);
  });

  it('FR-ARR-001: ungrouping a group in the middle of the z-order puts its members there, not at the bottom or the top', () => {
    const { run, rects, el } = setup(Array.from({ length: 5 }, (_, i) => ({ x: i * 40, y: 0, w: 30, h: 30, rot: 0 })));
    const [below, m1, m2, between, above] = rects as [RecordId, RecordId, RecordId, RecordId, RecordId];
    expect(run('element.group', { ids: [m1, m2], groupId: 'mid' }).ok).toBe(true);
    // a root now: below < mid < between < above
    expect(run('element.ungroup', { ids: ['mid'] }).ok).toBe(true);
    const order = [...rects].sort((x, y) => (el(x).index < el(y).index ? -1 : 1));
    expect(order).toEqual([below, m1, m2, between, above]);
  });
});
