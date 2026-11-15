import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { registerCoreCommands } from '../builtin-commands.js';
import { type AnyCommand, executeCommand } from '../commands.js';
import { type IntegrityHook, registerCoreHooks } from '../hooks.js';
import { createRegistry } from '../registry.js';
import { RecordStore } from '../store.js';

/** `count` rects on one screen, back to front, a second screen's rect, and the command runner. */
function setup(count: number) {
  const b = documentBuilder({ seed: 93 });
  const screen = b.screen();
  const ids = Array.from({ length: count }, (_, i) => b.rect(screen, { x: i * 20, y: 0, w: 10, h: 10 })) as RecordId[];
  const elsewhere = b.rect(b.screen(), { x: 0, y: 0, w: 10, h: 10 });
  const hooks = createRegistry<string, IntegrityHook>('integrityHooks');
  registerCoreHooks(hooks);
  const store = new RecordStore(b.build(), { hooks });
  const commands = createRegistry<string, AnyCommand>('commands');
  registerCoreCommands(commands);
  const run = (id: string, args: unknown) => executeCommand(commands, { store }, id, args);
  const index = (id: RecordId) => (store.get(id) as unknown as { index: string }).index;
  const order = (list: readonly RecordId[] = ids) => [...list].sort((x, y) => (index(x) < index(y) ? -1 : 1));
  const indices = () => Object.fromEntries([...store.members('byType', 'element')].map((x) => [x, index(x)]));
  return { store, run, ids, index, order, indices, elsewhere };
}

describe('element.reorder (FR-ARR-008)', () => {
  it('FR-ARR-008: placing an element in front of a sibling writes only its index, one undo step', () => {
    const { run, ids, order, indices, store } = setup(4);
    const [a, b, c, d] = ids as [RecordId, RecordId, RecordId, RecordId];
    const before = indices();
    expect(run('element.reorder', { id: d, after: a }).ok).toBe(true);
    expect(order()).toEqual([a, d, b, c]);
    const after = indices();
    expect(Object.keys(after).filter((x) => after[x] !== before[x])).toEqual([d]);
    store.history.undo();
    expect(order()).toEqual([a, b, c, d]);
    // no `after`: the very back; to the front is in front of the last
    expect(run('element.reorder', { id: c }).ok).toBe(true);
    expect(order()).toEqual([c, a, b, d]);
    expect(run('element.reorder', { id: a, after: d }).ok).toBe(true);
    expect(order()).toEqual([c, b, d, a]);
  });

  it('FR-ARR-008: an element already in that place keeps its key', () => {
    const { run, ids, indices } = setup(3);
    const before = indices();
    expect(run('element.reorder', { id: ids[1], after: ids[0] }).ok).toBe(true);
    expect(run('element.reorder', { id: ids[0] }).ok).toBe(true);
    expect(indices()).toEqual(before);
  });

  it('FR-ARR-008: a member moves among its group siblings and the group keeps its place', () => {
    const { run, ids, order, index, store } = setup(4);
    const [a, b, c, d] = ids as [RecordId, RecordId, RecordId, RecordId];
    expect(run('element.group', { ids: [b, c], groupId: 'g1' }).ok).toBe(true);
    const group = 'g1' as RecordId;
    const groupIndex = index(group);
    expect(run('element.reorder', { id: b, after: c }).ok).toBe(true);
    expect(order([b, c])).toEqual([c, b]);
    expect(index(group)).toBe(groupIndex);
    // a member cannot go in front of an element outside its group, nor a top-level element in front of a member
    const outside = run('element.reorder', { id: b, after: d });
    expect(outside.ok).toBe(false);
    expect(run('element.reorder', { id: a, after: c }).ok).toBe(false);
    expect(store.get(b)).toMatchObject({ parentId: group });
    if (!outside.ok) expect(outside.error.code).toBe('COMMAND_ARGS');
  });

  it('FR-ARR-008: an element on another screen, itself or a missing one is refused', () => {
    const { run, ids, elsewhere } = setup(2);
    expect(run('element.reorder', { id: ids[0], after: elsewhere }).ok).toBe(false);
    expect(run('element.reorder', { id: ids[0], after: ids[0] }).ok).toBe(false);
    expect(run('element.reorder', { id: ids[0], after: 'nope' }).ok).toBe(false);
  });
});
