import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { registerCoreCommands } from '../builtin-commands.js';
import { type AnyCommand, executeCommand } from '../commands.js';
import { type IntegrityHook, registerCoreHooks } from '../hooks.js';
import { createRegistry } from '../registry.js';
import { RecordStore } from '../store.js';

type T = { x: number; y: number; w: number; h: number; rot?: number };

/** Three rects at known places, a group of the first two, and an outer group of that group and the third. */
function setup() {
  const b = documentBuilder({ seed: 84 });
  const screen = b.screen();
  const rects = [
    b.rect(screen, { x: 0, y: 0, w: 100, h: 50 }),
    b.rect(screen, { x: 300, y: 200, w: 100, h: 100 }),
    b.rect(screen, { x: 600, y: 0, w: 20, h: 20 }),
  ] as [RecordId, RecordId, RecordId];
  const hooks = createRegistry<string, IntegrityHook>('integrityHooks');
  registerCoreHooks(hooks);
  const store = new RecordStore(b.build(), { hooks });
  const commands = createRegistry<string, AnyCommand>('commands');
  registerCoreCommands(commands);
  const run = (id: string, args: unknown) => executeCommand(commands, { store }, id, args);
  const t = (id: string) => (store.get(id as RecordId) as unknown as { transform: T }).transform;
  const box = (id: string) => ({ x: t(id).x, y: t(id).y, w: t(id).w, h: t(id).h });
  expect(run('element.group', { ids: [rects[0], rects[1]], groupId: 'inner' }).ok).toBe(true);
  expect(run('element.group', { ids: ['inner', rects[2]], groupId: 'outer' }).ok).toBe(true);
  return { store, run, rects, t, box };
}

describe('a group is the bounds of its members (FR-ARR-001, M8.5)', () => {
  it('FR-ARR-001: editing a member alone refits its group and the groups around it, in the same transaction and undo step', () => {
    const { store, run, rects, box } = setup();
    expect(box('inner')).toEqual({ x: 0, y: 0, w: 400, h: 300 });
    expect(box('outer')).toEqual({ x: 0, y: 0, w: 620, h: 300 });
    const steps = store.history.canUndo();
    // a member dragged far out of its group: both groups grow to hold it
    expect(run('element.update', { id: rects[1], fields: { transform: { x: 900, y: 700, w: 100, h: 100, rot: 0 } } }).ok).toBe(true);
    expect(box('inner')).toEqual({ x: 0, y: 0, w: 1000, h: 800 });
    expect(box('outer')).toEqual({ x: 0, y: 0, w: 1000, h: 800 });
    // one undo step puts the member and both groups back
    store.history.undo();
    expect(box('inner')).toEqual({ x: 0, y: 0, w: 400, h: 300 });
    expect(box('outer')).toEqual({ x: 0, y: 0, w: 620, h: 300 });
    expect(store.history.canUndo()).toBe(true);
    expect(steps).toBe(true);
  });

  it('FR-ARR-001: a member that leaves the group, is added or is deleted refits the group it left, joined or kept', () => {
    const { run, rects, box } = setup();
    // the third rectangle leaves the outer group for the screen root: the outer group shrinks to the inner one
    expect(run('element.update', { id: rects[2], fields: { parentId: undefined } }).ok).toBe(true);
    expect(box('outer')).toEqual({ x: 0, y: 0, w: 400, h: 300 });
    // joining again grows it
    expect(run('element.update', { id: rects[2], fields: { parentId: 'outer' } }).ok).toBe(true);
    expect(box('outer')).toEqual({ x: 0, y: 0, w: 620, h: 300 });
    // deleting a member shrinks the groups above it
    expect(run('element.delete', { ids: [rects[1]] }).ok).toBe(true);
    expect(box('inner')).toEqual({ x: 0, y: 0, w: 100, h: 50 });
    expect(box('outer')).toEqual({ x: 0, y: 0, w: 620, h: 50 });
  });

  it('FR-ARR-001: a rotated member counts by its drawn bounds, the group is unturned, and a group`s own edit is left as written', () => {
    const { run, rects, t } = setup();
    expect(run('element.update', { id: rects[2], fields: { transform: { x: 600, y: 0, w: 100, h: 100, rot: 45 } } }).ok).toBe(true);
    const outer = t('outer');
    // a 100 square turned 45° spans about 141 each way, about its centre (650, 50)
    expect(outer.w).toBeCloseTo(650 + 70.71, 1);
    expect(outer.rot).toBe(0);
    // editing the group's own record alone does not refit it: only a member's change does (a group's rot is its own business)
    expect(run('element.update', { id: 'outer', fields: { transform: { x: 5, y: 5, w: 10, h: 10, rot: 37 } } }).ok).toBe(true);
    expect(t('outer')).toMatchObject({ x: 5, y: 5, w: 10, h: 10, rot: 37 });
  });

  it('FR-ARR-001: a group with no member that has a box, or no member at all, is left as it is', () => {
    const b = documentBuilder({ seed: 85 });
    const screen = b.screen();
    const [p, q] = [b.rect(screen), b.rect(screen, { x: 300 })];
    const line = b.connect(p, q);
    const lonely = b.rect(screen, { x: 900, y: 900, w: 40, h: 40 });
    const hooks = createRegistry<string, IntegrityHook>('integrityHooks');
    registerCoreHooks(hooks);
    const store = new RecordStore(b.build(), { hooks });
    const commands = createRegistry<string, AnyCommand>('commands');
    registerCoreCommands(commands);
    const run = (id: string, args: unknown) => executeCommand(commands, { store }, id, args);
    const box = (id: string) => (store.get(id as RecordId) as unknown as { transform: T }).transform;
    // a group of a shape and a connector; the shape goes: only the connector (no box) is left in it
    expect(run('element.group', { ids: [p, line], groupId: 'mixed' }).ok).toBe(true);
    const before = { ...box('mixed') };
    expect(run('element.update', { id: line, fields: { name: 'renamed' } }).ok).toBe(true);
    expect(box('mixed')).toEqual(before);
    expect(run('element.update', { id: p, fields: { parentId: undefined } }).ok).toBe(true);
    // nothing in it has a box any more: the group keeps the box it had
    expect(box('mixed')).toEqual(before);
    // a group emptied by deleting its only member is kept too (and the next member edit elsewhere leaves it alone)
    expect(run('element.group', { ids: [lonely], groupId: 'empty' }).ok).toBe(true);
    const emptyBox = { ...box('empty') };
    expect(run('element.delete', { ids: [lonely] }).ok).toBe(true);
    expect(store.get('empty' as RecordId)).toBeDefined();
    expect(box('empty')).toEqual(emptyBox);
  });
});
