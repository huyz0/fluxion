import type { AnyRecord, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { registerCoreCommands } from './builtin-commands.js';
import { type AnyCommand, executeCommand } from './commands.js';
import { applyFork } from './fork.js';
import { type IntegrityHook, registerCoreHooks } from './hooks.js';
import { createRegistry } from './registry.js';
import { RecordStore, type StoreOptions } from './store.js';

function setup(options: StoreOptions = {}) {
  const b = documentBuilder({ seed: 70 });
  const s = b.screen();
  const a = b.rect(s);
  const c = b.rect(s, { x: 300 });
  const line = b.connect(a, c);
  const hooks = createRegistry<string, IntegrityHook>('integrityHooks');
  registerCoreHooks(hooks);
  const store = new RecordStore(b.build(), { hooks, ...options });
  const commands = createRegistry<string, AnyCommand>('commands');
  registerCoreCommands(commands);
  return { store, commands, a, c, line };
}
const name = (store: { get(id: RecordId): AnyRecord | undefined }, id: RecordId) => (store.get(id) as { name?: string } | undefined)?.name;

describe('forks and the read-only policy (ADR-0014 §Forks and policy)', () => {
  it('NFR-MNT-006: writes to a fork never reach the parent', () => {
    const { store, commands, a, c } = setup();
    const parentBefore = store.toDocument();
    const fork = store.fork();
    expect(fork.toDocument()).toEqual(parentBefore);
    expect(executeCommand(commands, { store: fork }, 'element.update', { id: a, fields: { name: 'in fork' } }).ok).toBe(true);
    expect(executeCommand(commands, { store: fork }, 'element.delete', { ids: [c] }).ok).toBe(true);
    expect(store.toDocument()).toEqual(parentBefore);
    // and later parent writes are not visible in the fork (a snapshot)
    expect(executeCommand(commands, { store }, 'element.update', { id: c, fields: { name: 'in parent' } }).ok).toBe(true);
    expect(fork.has(c)).toBe(false);
    expect(name(fork, a)).toBe('in fork');
    expect(name(store, a)).toBeUndefined();
    // indexes and history are the fork's own
    expect(fork.members('byType', 'binding')).toHaveLength(1);
    expect(store.members('byType', 'binding')).toHaveLength(2);
    expect([fork.history.undoDepth, store.history.undoDepth]).toEqual([2, 1]);
  });

  it('forks of forks and several forks stay independent (copy-on-write on every side)', () => {
    const { store, a } = setup();
    const f1 = store.fork();
    const f2 = store.fork();
    const f11 = f1.fork();
    f1.transact('f1', (tx) => tx.patch(a, { name: 'f1' }));
    f2.transact('f2', (tx) => tx.patch(a, { name: 'f2' }));
    f11.transact('f11', (tx) => tx.patch(a, { name: 'f11' }));
    expect([name(store, a), name(f1, a), name(f2, a), name(f11, a)]).toEqual([undefined, 'f1', 'f2', 'f11']);
  });

  it('NFR-MNT-006: fork.diffFrom applied to the parent keeps concurrent parent edits', () => {
    const { store, commands, a, c } = setup();
    const fork = store.fork();
    expect(executeCommand(commands, { store: fork }, 'element.update', { id: a, fields: { name: 'from fork' } }).ok).toBe(true);
    // the parent edits another record meanwhile
    expect(executeCommand(commands, { store }, 'element.update', { id: c, fields: { name: 'from parent' } }).ok).toBe(true);
    const diff = fork.diffFrom(store);
    expect([...(diff?.puts.keys() ?? [])]).toEqual([a]);
    const origins: string[] = [];
    store.subscribe((_d, meta) => origins.push(meta.origin));
    const r = applyFork(store, fork, 'apply preview');
    expect(r.ok).toBe(true);
    expect(origins).toEqual(['user']);
    expect([name(store, a), name(store, c)]).toEqual(['from fork', 'from parent']);
    // one user transaction: one undo step takes the preview back out
    expect(store.history.undoDepth).toBe(2);
    store.history.undo();
    expect([name(store, a), name(store, c)]).toEqual([undefined, 'from parent']);
    expect(store.diffFrom(fork)).toBeUndefined();
    expect(applyFork(fork, store).ok).toBe(false);
    // a fork applies only to its own parent
    const other = setup().store;
    expect(fork.diffFrom(other)).toBeUndefined();
    expect(applyFork(other, fork).ok).toBe(false);
    expect(other.history.undoDepth).toBe(0);
  });

  it('NFR-MNT-006: a read-only store rejects element.update with a diagnostic', () => {
    const { store, commands, a } = setup({ policy: 'read-only' });
    const before = store.toDocument();
    const r = executeCommand(commands, { store }, 'element.update', { id: a, fields: { name: 'x' } });
    expect(!r.ok && r.error.code).toBe('TX_READ_ONLY');
    expect(!r.ok && r.error.diagnostics).toEqual([expect.objectContaining({ code: 'FLX_READ_ONLY', path: '/commands/element.update' })]);
    const direct = store.transact('direct', (tx) => tx.patch(a, { name: 'x' }));
    expect(!direct.ok && direct.error.diagnostics.map((d) => d.code)).toEqual(['FLX_READ_ONLY']);
    expect(store.toDocument()).toEqual(before);
    expect(store.readOnly).toBe(true);
    // a fork is a preview: editable, and its edits stay out of the read-only parent
    const fork = store.fork();
    expect(fork.readOnly).toBe(false);
    expect(executeCommand(commands, { store: fork }, 'element.update', { id: a, fields: { name: 'preview' } }).ok).toBe(true);
    expect(store.toDocument()).toEqual(before);
  });

  it('NFR-MNT-006: applying a store that is not a fork carries a diagnostic', () => {
    const { store } = setup();
    const other = setup().store;
    const fork = store.fork();
    for (const [parent, child] of [
      [other, fork],
      [fork, store],
      [store, other],
    ] as const) {
      const r = applyFork(parent, child, 'apply');
      expect(!r.ok && r.error.code).toBe('TX_INVALID');
      expect(!r.ok && r.error.diagnostics).toEqual([expect.objectContaining({ code: 'FLX_FORK_UNRELATED', severity: 'error' })]);
    }
    expect([other.history.undoDepth, store.history.undoDepth]).toEqual([0, 0]);
  });
});
