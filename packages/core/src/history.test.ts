import type { AnyRecord, DocumentFile, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { registerCoreCommands } from './builtin-commands.js';
import { type AnyCommand, type CommandTxOptions, executeCommand } from './commands.js';
import { type IntegrityHook, registerCoreHooks } from './hooks.js';
import { createRegistry } from './registry.js';
import { RecordStore } from './store.js';

function setup() {
  const b = documentBuilder({ seed: 50 });
  const s1 = b.screen();
  const s2 = b.screen();
  const a = b.rect(s1);
  const c = b.rect(s1, { x: 300 });
  const line = b.connect(a, c);
  const hooks = createRegistry<string, IntegrityHook>('integrityHooks');
  registerCoreHooks(hooks);
  const store = new RecordStore(b.build(), { hooks });
  const commands = createRegistry<string, AnyCommand>('commands');
  registerCoreCommands(commands);
  const run = (id: string, args: unknown, options?: CommandTxOptions) => {
    const r = executeCommand(commands, options ? { store, options } : { store }, id, args);
    expect(r.ok, JSON.stringify(!r.ok && r.error)).toBe(true);
  };
  return { store, run, s1, s2, a, c, line };
}

describe('undo and redo (ADR-0014 §History)', () => {
  it('FR-EDT-006: WHEN undo then redo runs THE SYSTEM SHALL reproduce the post-state exactly', () => {
    const { store, run, s1, s2, a, c, line } = setup();
    const snapshots: DocumentFile[] = [store.toDocument()];
    const steps: Array<[string, unknown]> = [
      ['element.update', { id: a, fields: { name: 'A' } }],
      [
        'element.create',
        {
          element: {
            id: 'CreatedCreatedC1',
            type: 'element',
            kind: 'shape',
            defId: 'basic:rect',
            screenId: s2,
            index: 'a5',
            transform: { x: 1, y: 1, w: 1, h: 1 },
          },
        },
      ],
      ['element.delete', { ids: [c] }], // cascades: binding deleted, connector end freed
      ['screen.reorder', { id: s1, after: s2 }],
      ['binding.set', { id: 'BoundBoundBound1', connectorId: line, end: 'target', elementId: a, anchor: { kind: 'auto' } }],
      ['document.update', { fields: { title: 'T' } }],
    ];
    for (const [id, args] of steps) {
      run(id, args);
      snapshots.push(store.toDocument());
    }
    expect(store.history.undoDepth).toBe(steps.length);
    for (let i = steps.length - 1; i >= 0; i--) {
      expect(store.history.undo().ok).toBe(true);
      expect(store.toDocument()).toEqual(snapshots[i]);
    }
    expect(store.history.canUndo()).toBe(false);
    for (let i = 1; i <= steps.length; i++) {
      expect(store.history.redo().ok).toBe(true);
      expect(store.toDocument()).toEqual(snapshots[i]);
    }
    expect(store.history.canRedo()).toBe(false);
  });

  it('FR-EDT-006: undo restores the metaBefore an element.update command recorded', () => {
    const { store, run, a } = setup();
    run('element.update', { id: a, fields: { name: 'A' } }, { metaBefore: { screen: 1, selection: [a] }, metaAfter: { screen: 2 } });
    expect(store.history.undo()).toEqual({ ok: true, value: { screen: 1, selection: [a] } });
    expect(store.history.redo()).toEqual({ ok: true, value: { screen: 2 } });
  });

  it('undo and redo are not recorded; a new user transaction clears redo; remote writes are not recorded', () => {
    const { store, run, a } = setup();
    run('element.update', { id: a, fields: { name: '1' } });
    run('element.update', { id: a, fields: { name: '2' } });
    store.history.undo();
    expect([store.history.undoDepth, store.history.redoDepth]).toEqual([1, 1]);
    run('element.update', { id: a, fields: { name: '3' } });
    expect([store.history.undoDepth, store.history.redoDepth]).toEqual([2, 0]);
    run('element.update', { id: a, fields: { name: 'r' } }, { origin: 'remote' });
    expect(store.history.undoDepth).toBe(2);
    const empty = new RecordStore(documentBuilder({ seed: 51 }).build());
    expect(empty.history.undo()).toEqual({ ok: false, error: expect.objectContaining({ code: 'HISTORY_EMPTY' }) });
    expect(empty.history.redo()).toEqual({ ok: false, error: expect.objectContaining({ code: 'HISTORY_EMPTY' }) });
  });

  it('FR-EDT-006: undo and redo commit as "undo <label>" and "redo <label>"; an empty history says what it lacks', () => {
    const { store, run, a } = setup();
    run('element.update', { id: a, fields: { name: 'A' } });
    const labels: string[] = [];
    store.subscribe((_d, meta) => labels.push(`${meta.origin}:${meta.label}`));
    expect(store.history.undo().ok).toBe(true);
    expect(store.history.redo().ok).toBe(true);
    expect(labels).toEqual(['undo:undo element.update', 'redo:redo element.update']);
    const empty = new RecordStore(documentBuilder({ seed: 52 }).build());
    for (const [what, r] of [
      ['undo', empty.history.undo()],
      ['redo', empty.history.redo()],
    ] as const) {
      expect(!r.ok && r.error.message).toContain(what);
    }
  });

  it('FR-EDT-006: an undo or redo that fails validation keeps its entry where it was', () => {
    const b = documentBuilder({ seed: 53 });
    const s1 = b.screen();
    b.screen();
    const a = b.rect(s1);
    const store = new RecordStore(b.build());
    expect(store.transact('delete a', (tx) => tx.delete(a)).ok).toBe(true);
    // a remote write removes a's screen: putting a back would leave it dangling
    expect(store.transact('remote', (tx) => tx.delete(s1), { origin: 'remote' }).ok).toBe(true);
    const undo = store.history.undo();
    expect(!undo.ok && undo.error.code).toBe('TX_INVALID');
    expect([store.history.undoDepth, store.history.redoDepth]).toEqual([1, 0]);
    expect(store.has(a)).toBe(false);
    // redo: an entry whose re-delete would strand a comment added meanwhile
    const other = documentBuilder({ seed: 54 });
    const e = other.rect(other.screen());
    const second = new RecordStore(other.build());
    expect(second.transact('delete e', (tx) => tx.delete(e)).ok).toBe(true);
    expect(second.history.undo().ok).toBe(true);
    const comment = { id: 'CommentComment01', type: 'comment', targetId: e, author: 'x', body: 'y' } as unknown as AnyRecord;
    expect(second.transact('remote', (tx) => tx.put(comment), { origin: 'remote' }).ok).toBe(true);
    const redo = second.history.redo();
    expect(!redo.ok && redo.error.code).toBe('TX_INVALID');
    expect([second.history.undoDepth, second.history.redoDepth]).toEqual([0, 1]);
    expect(second.has(e)).toBe(true);
  });

  it('FR-EDT-006: a merge key never reaches into an entry that is no longer the latest undo step', () => {
    const { store, a, c } = setup();
    expect(store.transact('first', (tx) => tx.patch(c, { name: 'c' })).ok).toBe(true);
    expect(store.transact('drag', (tx) => tx.patch(a, { name: 'x' }), { mergeKey: 'k' }).ok).toBe(true);
    // the record is put back behind history's back (core-internal apply), so undoing the drag
    // changes nothing and commits nothing: the drag entry moves to redo while still open
    const original = { ...(store.get(a) as AnyRecord & { name?: string }) };
    delete original.name;
    store.apply([original as AnyRecord], []);
    expect(store.history.undo().ok).toBe(true);
    expect([store.history.undoDepth, store.history.redoDepth]).toEqual([1, 1]);
    expect(store.transact('drag', (tx) => tx.patch(a, { name: 'y' }), { mergeKey: 'k' }).ok).toBe(true);
    // a new entry on top of `first`, not a merge that pops `first`
    expect(store.history.undoDepth).toBe(2);
    expect(store.history.undo().ok).toBe(true);
    expect((store.get(c) as { name?: string }).name).toBe('c');
  });

  it('depth is unlimited within a session', () => {
    const { store, run, a } = setup();
    for (let i = 0; i < 250; i++) run('element.update', { id: a, fields: { name: `n${i}` } });
    expect(store.history.undoDepth).toBe(250);
    for (let i = 0; i < 250; i++) expect(store.history.undo().ok).toBe(true);
    expect((store.get(a as RecordId) as { name?: string }).name).toBeUndefined();
  });
});
