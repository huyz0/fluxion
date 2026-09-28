import type { DocumentFile, RecordId } from '@fluxion/schema';
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

  it('depth is unlimited within a session', () => {
    const { store, run, a } = setup();
    for (let i = 0; i < 250; i++) run('element.update', { id: a, fields: { name: `n${i}` } });
    expect(store.history.undoDepth).toBe(250);
    for (let i = 0; i < 250; i++) expect(store.history.undo().ok).toBe(true);
    expect((store.get(a as RecordId) as { name?: string }).name).toBeUndefined();
  });
});
