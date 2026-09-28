import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { registerCoreCommands } from './builtin-commands.js';
import { type AnyCommand, type CommandTxOptions, executeCommand } from './commands.js';
import { type IntegrityHook, registerCoreHooks } from './hooks.js';
import { createRegistry } from './registry.js';
import { RecordStore } from './store.js';

function setup() {
  const b = documentBuilder({ seed: 60 });
  const s = b.screen();
  const a = b.rect(s, { x: 0, y: 0 });
  const c = b.rect(s, { x: 300 });
  const hooks = createRegistry<string, IntegrityHook>('integrityHooks');
  registerCoreHooks(hooks);
  const store = new RecordStore(b.build(), { hooks });
  const commands = createRegistry<string, AnyCommand>('commands');
  registerCoreCommands(commands);
  const run = (id: string, args: unknown, options?: CommandTxOptions) => executeCommand(commands, options ? { store, options } : { store }, id, args);
  const move = (x: number, options: CommandTxOptions = { mergeKey: 'drag' }) =>
    run('element.update', { id: a, fields: { transform: { x, y: 0, w: 160, h: 80 } } }, options);
  return { store, run, move, a, c };
}

const x = (store: RecordStore, id: RecordId) => (store.get(id) as { transform: { x: number } }).transform.x;

describe('transaction merging (ADR-0014 §Merging)', () => {
  it('FR-EDT-006: WHEN 60 merged element.update commands share a key THE SYSTEM SHALL create 1 history entry', () => {
    const { store, move, a } = setup();
    const before = store.toDocument();
    // each step's metaBefore differs: the merged entry must keep the first one (M3.20 review F1)
    for (let i = 1; i <= 60; i++) expect(move(i * 5, { mergeKey: 'drag', metaBefore: { at: i - 1 }, metaAfter: { at: i } }).ok).toBe(true);
    expect(store.history.undoDepth).toBe(1);
    expect(x(store, a)).toBe(300);
    // one undo takes the whole drag back, to the meta the gesture started with
    expect(store.history.undo()).toEqual({ ok: true, value: { at: 0 } });
    expect(store.toDocument()).toEqual(before);
    expect(store.history.redo()).toEqual({ ok: true, value: { at: 60 } });
    expect(x(store, a)).toBe(300);
  });

  it('FR-EDT-006: an empty-diff transaction does not break a merge', () => {
    const { store, run, move, c } = setup();
    move(10);
    // writes nothing new (same value): never recorded, so the drag goes on merging (M3.2 F3)
    expect(run('element.update', { id: c, fields: { transform: (store.get(c) as { transform: unknown }).transform } }).ok).toBe(true);
    move(20);
    expect(store.history.undoDepth).toBe(1);
  });

  it('an interleaved transaction, a seal, another key or origin, or an undo breaks a merge', () => {
    const { store, run, move, c } = setup();
    move(10);
    run('element.update', { id: c, fields: { name: 'c' } });
    move(20);
    expect(store.history.undoDepth).toBe(3);
    store.history.seal();
    move(30);
    expect(store.history.undoDepth).toBe(4);
    move(40, { mergeKey: 'other' });
    expect(store.history.undoDepth).toBe(5);
    move(50, { mergeKey: 'other', origin: 'system' });
    expect(store.history.undoDepth).toBe(6);
    store.history.undo();
    move(60, { mergeKey: 'other', origin: 'system' });
    expect(store.history.undoDepth).toBe(6);
  });

  it('an undo and redo in between break a merge, even with the redone entry back on top (M3.20 review F2)', () => {
    const { store, move } = setup();
    move(10);
    store.history.undo();
    store.history.redo();
    move(20);
    expect(store.history.undoDepth).toBe(2);
  });

  it('a merged gesture that ends where it started leaves no entry', () => {
    const { store, move, a } = setup();
    const start = x(store, a);
    move(100);
    move(start);
    expect(store.history.undoDepth).toBe(0);
  });

  it('batch groups several commands into one undo step', () => {
    const { store, run, a, c } = setup();
    const before = store.toDocument();
    const r = store.history.batch('rename both', () => {
      expect(run('element.update', { id: a, fields: { name: 'A' } }).ok).toBe(true);
      expect(run('element.update', { id: c, fields: { name: 'C' } }).ok).toBe(true);
    });
    expect(r.ok).toBe(true);
    expect(store.history.undoDepth).toBe(1);
    store.history.undo();
    expect(store.toDocument()).toEqual(before);
  });
});
