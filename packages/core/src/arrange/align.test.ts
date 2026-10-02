import { elementBounds } from '@fluxion/geometry';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { registerCoreCommands } from '../builtin-commands.js';
import { type AnyCommand, executeCommand } from '../commands.js';
import { type IntegrityHook, registerCoreHooks } from '../hooks.js';
import { createRegistry } from '../registry.js';
import { RecordStore } from '../store.js';
import { type AlignMode, alignDelta } from './align.js';

type T = { x: number; y: number; w: number; h: number; rot?: number };
const MODES: readonly AlignMode[] = ['left', 'center', 'right', 'top', 'middle', 'bottom'];

/** A screen 1000 x 600 with three shapes: a (20,40 100x50), b (300,200 200x100), c (700,80 60x60 turned 45°). */
function setup() {
  const b = documentBuilder({ seed: 86 });
  const screen = b.screen({ size: { w: 1000, h: 600 } });
  const ids = [
    b.rect(screen, { x: 20, y: 40, w: 100, h: 50 }),
    b.rect(screen, { x: 300, y: 200, w: 200, h: 100 }),
    b.rect(screen, { x: 700, y: 80, w: 60, h: 60, rot: 45 }),
  ] as [RecordId, RecordId, RecordId];
  const hooks = createRegistry<string, IntegrityHook>('integrityHooks');
  registerCoreHooks(hooks);
  const store = new RecordStore(b.build(), { hooks });
  const commands = createRegistry<string, AnyCommand>('commands');
  registerCoreCommands(commands);
  const run = (id: string, args: unknown) => executeCommand(commands, { store }, id, args);
  const bounds = (id: RecordId) => elementBounds({ rot: 0, ...(store.get(id) as unknown as { transform: T }).transform });
  return { store, run, ids, screen, bounds };
}

/** The coordinate a mode lines up: the left edge, the centre, ... of a box. */
const edge = (b: { x: number; y: number; w: number; h: number }, mode: AlignMode) =>
  ({ left: b.x, center: b.x + b.w / 2, right: b.x + b.w, top: b.y, middle: b.y + b.h / 2, bottom: b.y + b.h })[mode];

type Bx = { x: number; y: number; w: number; h: number };

/** The box a reference stands for: the whole screen, the key (the second shape) or the union of the shapes' drawn bounds. */
function referenceOf(to: 'selection' | 'screen' | 'key', boxes: readonly Bx[]): Bx {
  if (to === 'screen') return { x: 0, y: 0, w: 1000, h: 600 };
  if (to === 'key') return boxes[1] as Bx;
  const [x, y] = [Math.min(...boxes.map((b) => b.x)), Math.min(...boxes.map((b) => b.y))];
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
}

/** Align the three shapes by `mode` against `to`: each one's drawn edge (centre) lands on the reference's, the other axis untouched. */
function alignsAgainst(mode: AlignMode, to: 'selection' | 'screen' | 'key'): void {
  const { run, ids, bounds } = setup();
  const before = ids.map(bounds);
  const reference = referenceOf(to, before);
  const r = run('element.align', { ids, mode, to: to === 'key' ? { key: ids[1] } : to });
  expect(r.ok, `${mode} ${to}`).toBe(true);
  const other = mode === 'left' || mode === 'center' || mode === 'right' ? 'y' : 'x';
  for (const [i, b] of ids.map(bounds).entries()) {
    expect(edge(b, mode), `${mode} ${to} #${i}`).toBeCloseTo(edge(reference, mode), 6);
    expect(b[other]).toBeCloseTo((before[i] as Bx)[other], 6);
  }
  if (to === 'key') expect(bounds(ids[1] as RecordId)).toEqual(before[1]);
}

describe('align (FR-ARR-002)', () => {
  it('FR-ARR-002: align places every mode against every reference, rotated shapes by world bounds', () => {
    for (const mode of MODES) for (const to of ['selection', 'screen', 'key'] as const) alignsAgainst(mode, to);
  });

  it('FR-ARR-002: alignDelta is the shift that brings one box edge to the reference`s, on one axis only', () => {
    const box = { x: 10, y: 20, w: 30, h: 40 };
    const ref = { x: 100, y: 200, w: 300, h: 400 };
    expect(MODES.map((m) => alignDelta(box, m, ref))).toEqual([
      { x: 90, y: 0 },
      { x: 225, y: 0 },
      { x: 360, y: 0 },
      { x: 0, y: 180 },
      { x: 0, y: 360 },
      { x: 0, y: 540 },
    ]);
  });

  it('FR-ARR-002: a group moves with its members, once, and its members listed with it do not move twice', () => {
    const { run, ids, store, bounds } = setup();
    expect(run('element.group', { ids: [ids[0], ids[1]], groupId: 'pair' }).ok).toBe(true);
    const before = ids.map(bounds);
    expect(run('element.align', { ids: ['pair', ids[0], ids[2]], mode: 'right', to: 'screen' }).ok).toBe(true);
    const g = store.get('pair' as RecordId) as unknown as { transform: T };
    expect(g.transform.x + g.transform.w).toBeCloseTo(1000, 6);
    // the pair moved as one, both members by the same 500 (the group's right edge was at 500): their gap is kept
    const [a, b] = [bounds(ids[0]), bounds(ids[1])];
    expect(a.x - (before[0] as typeof a).x).toBeCloseTo(500, 6);
    expect(b.x - (before[1] as typeof b).x).toBeCloseTo(500, 6);
    expect(b.x - a.x).toBeCloseTo((before[1] as typeof a).x - (before[0] as typeof a).x, 6);
    expect(bounds(ids[2]).x + bounds(ids[2]).w).toBeCloseTo(1000, 6);
  });

  it('FR-ARR-002: align is one undo step, and refuses what it cannot place', () => {
    const { run, ids, store, screen, bounds } = setup();
    const before = ids.map(bounds);
    const steps = store.history.canUndo();
    expect(run('element.align', { ids, mode: 'top', to: 'selection' }).ok).toBe(true);
    store.history.undo();
    expect(ids.map(bounds)).toEqual(before);
    expect(store.history.canUndo()).toBe(steps);
    const code = (r: { ok: boolean; error?: { code: string } }) => (r.ok ? 'ok' : r.error?.code);
    // a key that is not among the aligned, an unknown id, a screen as the thing to align
    expect(code(run('element.align', { ids: [ids[0], ids[1]], mode: 'left', to: { key: ids[2] } }))).toBe('COMMAND_ARGS');
    expect(code(run('element.align', { ids: ['nope'], mode: 'left', to: 'screen' }))).toBe('COMMAND_ARGS');
    expect(code(run('element.align', { ids: [screen], mode: 'left', to: 'screen' }))).toBe('COMMAND_ARGS');
    // a connector has no box: nothing to place
    const b = documentBuilder({ seed: 87 });
    const s = b.screen();
    const line = b.connect({ x: 0, y: 0 }, { x: 10, y: 10 });
    const lone = new RecordStore(b.build(), {
      hooks: (() => {
        const h = createRegistry<string, IntegrityHook>('integrityHooks');
        registerCoreHooks(h);
        return h;
      })(),
    });
    const commands = createRegistry<string, AnyCommand>('commands');
    registerCoreCommands(commands);
    expect(code(executeCommand(commands, { store: lone }, 'element.align', { ids: [line], mode: 'left', to: 'screen' }))).toBe('COMMAND_ARGS');
    expect(s).toBeDefined();
  });

  it('FR-ARR-002: an infinite screen has no edges to align to', () => {
    const b = documentBuilder({ seed: 88 });
    const s = b.screen();
    const r = b.rect(s);
    const file = b.build();
    const records = { ...file.records, [s]: { ...(file.records[s] as object), kind: 'infinite', viewport: { x: 0, y: 0, w: 800, h: 600 } } };
    const hooks = createRegistry<string, IntegrityHook>('integrityHooks');
    registerCoreHooks(hooks);
    const store = new RecordStore({ ...file, records } as typeof file, { hooks });
    const commands = createRegistry<string, AnyCommand>('commands');
    registerCoreCommands(commands);
    const run = (id: string, args: unknown) => executeCommand(commands, { store }, id, args);
    expect(run('element.align', { ids: [r], mode: 'left', to: 'screen' }).ok).toBe(false);
    expect(run('element.align', { ids: [r], mode: 'left', to: 'selection' }).ok).toBe(true);
  });

  it('FR-ARR-002: a group`s free connector moves with it (ends and waypoints), and shapes of two screens cannot be aligned to a screen', () => {
    const b = documentBuilder({ seed: 89 });
    const [s1, s2] = [b.screen({ size: { w: 1000, h: 600 } }), b.screen({ size: { w: 1000, h: 600 } })];
    const shape = b.rect(s1, { x: 100, y: 100, w: 100, h: 100 });
    const free = b.connect({ x: 10, y: 10 }, { x: 60, y: 60 });
    const other = b.rect(s2, { x: 100, y: 100, w: 100, h: 100 });
    const hooks = createRegistry<string, IntegrityHook>('integrityHooks');
    registerCoreHooks(hooks);
    const store = new RecordStore(b.build(), { hooks });
    const commands = createRegistry<string, AnyCommand>('commands');
    registerCoreCommands(commands);
    const run = (id: string, args: unknown) => executeCommand(commands, { store }, id, args);
    expect(run('element.update', { id: free, fields: { route: { type: 'straight', waypoints: [{ x: 30, y: 40 }] } } }).ok).toBe(true);
    expect(run('element.group', { ids: [shape, free], groupId: 'withline' }).ok).toBe(true);
    // the group's right edge goes to 1000: everything in it moves by 800 (the shape's right edge was at 200)
    const g0 = store.get('withline' as RecordId) as unknown as { transform: T };
    const dx = 1000 - (g0.transform.x + g0.transform.w);
    expect(run('element.align', { ids: ['withline'], mode: 'right', to: 'screen' }).ok).toBe(true);
    const line = store.get(free) as unknown as { freeSource: { x: number }; freeTarget: { x: number }; route: { waypoints: { x: number; y: number }[] } };
    expect([line.freeSource.x, line.freeTarget.x, line.route.waypoints[0]?.x]).toEqual([10 + dx, 60 + dx, 30 + dx]);
    expect(line.route.waypoints[0]?.y).toBe(40);
    // two screens: no one screen to align to
    const refused = run('element.align', { ids: [shape, other], mode: 'left', to: 'screen' });
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error.code).toBe('COMMAND_ARGS');
    // but the selection's own bounds are a reference anywhere
    expect(run('element.align', { ids: [shape, other], mode: 'left', to: 'selection' }).ok).toBe(true);
  });
});
