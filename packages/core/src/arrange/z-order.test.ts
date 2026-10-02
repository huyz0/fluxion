import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { registerCoreCommands } from '../builtin-commands.js';
import { type AnyCommand, executeCommand } from '../commands.js';
import { type IntegrityHook, registerCoreHooks } from '../hooks.js';
import { createRegistry } from '../registry.js';
import { RecordStore } from '../store.js';
import { type ZOrder, zOrdered } from './z-order.js';

/** `count` rects on one screen, back to front in the order returned, and the command runner. */
function setup(count: number) {
  const b = documentBuilder({ seed: 92 });
  const screen = b.screen();
  const ids = Array.from({ length: count }, (_, i) => b.rect(screen, { x: i * 20, y: 0, w: 10, h: 10 }));
  const hooks = createRegistry<string, IntegrityHook>('integrityHooks');
  registerCoreHooks(hooks);
  const store = new RecordStore(b.build(), { hooks });
  const commands = createRegistry<string, AnyCommand>('commands');
  registerCoreCommands(commands);
  const run = (id: string, args: unknown) => executeCommand(commands, { store }, id, args);
  const index = (id: RecordId) => (store.get(id) as unknown as { index: string }).index;
  const order = () => [...ids].sort((x, y) => (index(x) < index(y) ? -1 : 1));
  return { store, run, ids, index, order, screen };
}

const MODES: readonly ZOrder[] = ['front', 'forward', 'backward', 'back'];

describe('z-order (FR-ARR-004)', () => {
  it('FR-ARR-004: bringing an element forward changes exactly one record index', () => {
    const { run, ids, order, store, index } = setup(5);
    const before = Object.fromEntries(ids.map((i) => [i, index(i)]));
    const steps = store.history.canUndo();
    expect(run('element.zOrder', { ids: [ids[1]], to: 'forward' }).ok).toBe(true);
    // one record changed, and the element is one place higher
    const changed = ids.filter((i) => index(i) !== before[i]);
    expect(changed).toEqual([ids[1]]);
    expect(order()).toEqual([ids[0], ids[2], ids[1], ids[3], ids[4]]);
    store.history.undo();
    expect(order()).toEqual(ids);
    expect(store.history.canUndo()).toBe(steps);
  });

  it('FR-ARR-004: front, back and backward move one element over the right neighbours and touch only it', () => {
    const { run, ids, order, index } = setup(5);
    const [a, b, c, d, e] = ids as [RecordId, RecordId, RecordId, RecordId, RecordId];
    const check = (target: RecordId, to: ZOrder, expected: RecordId[]) => {
      const before = Object.fromEntries(ids.map((i) => [i, index(i)]));
      expect(run('element.zOrder', { ids: [target], to }).ok).toBe(true);
      expect(order()).toEqual(expected);
      expect(ids.filter((i) => index(i) !== before[i])).toEqual([target]);
    };
    check(b, 'front', [a, c, d, e, b]);
    check(b, 'backward', [a, c, d, b, e]);
    check(e, 'back', [e, a, c, d, b]);
    // already there: nothing changes
    const before = ids.map(index);
    expect(run('element.zOrder', { ids: [e], to: 'back' }).ok).toBe(true);
    expect(run('element.zOrder', { ids: [b], to: 'front' }).ok).toBe(true);
    expect(ids.map(index)).toEqual(before);
  });

  it('FR-ARR-004: zOrdered keeps the others in order and moves the selected as a block, for every mode', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 9 }), fc.integer({ min: 1, max: 511 }), fc.constantFrom(...MODES), (n, mask, mode) => {
        const list = Array.from({ length: n }, (_, i) => `e${i}`);
        const picked = new Set(list.filter((_, i) => (mask >> i) & 1));
        const out = zOrdered(list, picked, mode);
        expect([...out].sort()).toEqual([...list].sort());
        // the unselected keep their order, the selected keep theirs
        expect(out.filter((x) => !picked.has(x))).toEqual(list.filter((x) => !picked.has(x)));
        expect(out.filter((x) => picked.has(x))).toEqual(list.filter((x) => picked.has(x)));
        if (mode === 'front') expect(out.slice(out.length - picked.size).every((x) => picked.has(x))).toBe(true);
        if (mode === 'back') expect(out.slice(0, picked.size).every((x) => picked.has(x))).toBe(true);
      }),
    );
    expect(zOrdered(['a', 'b', 'c', 'd'], new Set(['a', 'c']), 'forward')).toEqual(['b', 'a', 'd', 'c']);
    expect(zOrdered(['a', 'b', 'c', 'd'], new Set(['b', 'd']), 'backward')).toEqual(['b', 'a', 'd', 'c']);
    // selected neighbours move as a block, the top one stopping at the top
    expect(zOrdered(['a', 'b', 'c'], new Set(['b', 'c']), 'forward')).toEqual(['a', 'b', 'c']);
  });

  it('FR-ARR-004: a selection moves in one undo step, groups by their own index only, and what is not an element is refused', () => {
    const { run, ids, order, store, screen, index } = setup(6);
    expect(run('element.group', { ids: [ids[1], ids[2]], groupId: 'pair' }).ok).toBe(true);
    const memberIndexes = [index(ids[1] as RecordId), index(ids[2] as RecordId)];
    const steps = store.history.canUndo();
    expect(run('element.zOrder', { ids: ['pair', ids[4]], to: 'back' }).ok).toBe(true);
    // the group went behind, its members' own indexes unchanged
    expect([index(ids[1] as RecordId), index(ids[2] as RecordId)]).toEqual(memberIndexes);
    const root = [...ids, 'pair' as RecordId].filter((i) => (store.get(i) as unknown as { parentId?: string }).parentId === undefined);
    expect(root.sort((x, y) => (index(x) < index(y) ? -1 : 1)).slice(0, 2)).toEqual(['pair', ids[4]]);
    store.history.undo();
    expect(store.history.canUndo()).toBe(steps);
    const code = (r: { ok: boolean; error?: { code: string } }) => (r.ok ? 'ok' : r.error?.code);
    expect(code(run('element.zOrder', { ids: [screen], to: 'front' }))).toBe('COMMAND_ARGS');
    expect(code(run('element.zOrder', { ids: ['nope'], to: 'front' }))).toBe('COMMAND_ARGS');
    // elements of different parents are ordered among their own siblings, each in one transaction: here a member of a
    // group (above its sibling in the group) and a root element (above the others at the root)
    const parentOf = (x: RecordId) => (store.get(x) as unknown as { parentId?: string }).parentId;
    const among = (parent: string | undefined) =>
      [...ids, 'pair' as RecordId].filter((x) => parentOf(x) === parent).sort((x, y) => (index(x) < index(y) ? -1 : 1));
    expect(run('element.zOrder', { ids: [ids[1], ids[0]], to: 'front' }).ok).toBe(true);
    expect(among('pair')).toEqual([ids[2], ids[1]]);
    expect(among(undefined).at(-1)).toBe(ids[0]);
    expect(among(undefined)).toEqual(['pair', ids[3], ids[4], ids[5], ids[0]]);
  });

  it('FR-ARR-004: a selection moves forward and backward as a block through the command, writing only what moved', () => {
    const { run, ids, order, index } = setup(6);
    const [a, b, c, d, e, f] = ids as [RecordId, RecordId, RecordId, RecordId, RecordId, RecordId];
    const before = Object.fromEntries(ids.map((i) => [i, index(i)]));
    expect(run('element.zOrder', { ids: [a, c], to: 'forward' }).ok).toBe(true);
    expect(order()).toEqual([b, a, d, c, e, f]);
    expect(ids.filter((i) => index(i) !== before[i]).sort()).toEqual([a, c].sort());
    expect(run('element.zOrder', { ids: [c, f], to: 'backward' }).ok).toBe(true);
    expect(order()).toEqual([b, a, c, d, f, e]);
    // the top one stops at the top; picked neighbours stay together
    expect(run('element.zOrder', { ids: [e, f], to: 'forward' }).ok).toBe(true);
    expect(order()).toEqual([b, a, c, d, f, e]);
  });
});
