import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { registerCoreCommands } from './builtin-commands.js';
import { type AnyCommand, executeCommand } from './commands.js';
import { type IntegrityHook, registerCoreHooks } from './hooks.js';
import { createRegistry } from './registry.js';
import { RecordStore } from './store.js';
import type { Diff } from './transaction.js';

/** A store with the core hooks, a screen with two shapes joined by a connector, and the built-ins. */
function setup() {
  const b = documentBuilder({ seed: 40 });
  const s1 = b.screen();
  const a = b.rect(s1);
  const c = b.rect(s1, { x: 300 });
  const line = b.connect(a, c);
  const hooks = createRegistry<string, IntegrityHook>('integrityHooks');
  registerCoreHooks(hooks);
  const store = new RecordStore(b.build(), { hooks });
  const commands = createRegistry<string, AnyCommand>('commands');
  registerCoreCommands(commands);
  const diffs: Diff[] = [];
  store.subscribe((d) => diffs.push(d));
  const run = (id: string, args: unknown) => executeCommand(commands, { store }, id, args);
  return { store, run, diffs, s1, a, c, line };
}

// several elements in one transaction: the editor's gestures (a moved selection, a duplicate; M6.14)
describe('built-in commands on several elements (FR-EDT-005)', () => {
  it('FR-EDT-005: element.createMany and element.updateMany change several elements in one transaction', () => {
    const { store, run, diffs, s1, a, line } = setup();
    const shape = (id: string, x: number) => ({
      id,
      type: 'element',
      kind: 'shape',
      defId: 'basic:rect',
      screenId: s1,
      index: `a${x}`,
      transform: { x, y: 0, w: 5, h: 5 },
    });
    const before = diffs.length;
    expect(run('element.createMany', { elements: [shape('ManyManyManyMan1', 7), shape('ManyManyManyMan2', 8)] }).ok).toBe(true);
    expect([store.has('ManyManyManyMan1' as RecordId), store.has('ManyManyManyMan2' as RecordId), diffs.length - before]).toEqual([true, true, 1]);
    expect(
      run('element.updateMany', {
        updates: [
          { id: a, fields: { name: 'A' } },
          { id: line, fields: { name: 'L' } },
        ],
      }).ok,
    ).toBe(true);
    expect([(store.get(a) as { name?: string }).name, (store.get(line) as { name?: string }).name, diffs.length - before]).toEqual(['A', 'L', 2]);
    // refused whole: a repeated new id, an id in use, a record that is no element, an empty list
    const snapshot = store.toDocument();
    const refusals = [
      [run('element.createMany', { elements: [shape('ManyManyManyMan3', 1), shape('ManyManyManyMan3', 2)] }), '/args/elements/1/id'],
      [run('element.createMany', { elements: [shape('ManyManyManyMan4', 1), shape(a, 2)] }), '/args/elements/1/id'],
      [
        run('element.updateMany', {
          updates: [
            { id: a, fields: {} },
            { id: s1, fields: { name: 'x' } },
          ],
        }),
        '/args/updates/1/id',
      ],
      [run('element.updateMany', { updates: [{ id: a, fields: { id: 'x' } }] }), '/args/updates/0/fields/id'],
    ] as const;
    for (const [r, path] of refusals) {
      expect(!r.ok && r.error.code).toBe('COMMAND_ARGS');
      expect(!r.ok && r.error.diagnostics).toEqual([expect.objectContaining({ code: 'FLX_COMMAND_ARGS', path })]);
    }
    expect(run('element.createMany', { elements: [] }).ok).toBe(false);
    expect(run('element.updateMany', { updates: [] }).ok).toBe(false);
    expect(store.toDocument()).toEqual(snapshot);
  });
});

describe('document.applyRecords (FR-AI-010)', () => {
  it('FR-AI-010: puts and deletes a prepared record set in one transaction', () => {
    const { store, run, diffs, s1, a, c, line } = setup();
    const kept = store.get(c) as { id: string };
    const moved = { ...(store.get(a) as { id: string; type: string }), name: 'renamed' };
    const before = diffs.length;
    // delete the connector with its end and a binding-free shape; replace another record whole
    expect(run('document.applyRecords', { puts: [moved], deletes: [line] }).ok).toBe(true);
    expect(diffs.length).toBe(before + 1);
    expect(store.has(line as RecordId)).toBe(false);
    expect((store.get(a) as { name?: string }).name).toBe('renamed');
    expect(store.get(c)).toEqual(kept);
    expect(store.has(s1 as RecordId)).toBe(true);
  });

  it('FR-AI-010: a record set that leaves a dangling reference is refused and changes nothing', () => {
    const { store, run, a } = setup();
    const size = store.size;
    const stray = { ...(store.get(a) as { id: string; type: string }), id: 'Stray0000000000', screenId: 'Missing0000000' };
    expect(run('document.applyRecords', { puts: [stray], deletes: [] }).ok).toBe(false);
    expect(store.size).toBe(size);
    expect(store.has(a)).toBe(true);
  });

  it("FR-AI-010: a put cannot change a record's type, a record is put once, a delete names an existing record and never the document", () => {
    const { store, run, a, s1, line } = setup();
    const size = store.size;
    const asScreen = { ...(store.get(a) as { id: string; type: string }), type: 'screen' };
    const doc = store.members('byType', 'document')[0] as string;
    const rec = store.get(a) as { id: string; type: string };
    const refused = (args: unknown) => {
      const r = run('document.applyRecords', args);
      return r.ok ? 'ok' : r.error.code;
    };
    expect(refused({ puts: [asScreen], deletes: [] })).toBe('COMMAND_ARGS');
    expect(refused({ puts: [rec, rec], deletes: [] })).toBe('COMMAND_ARGS');
    expect(refused({ puts: [], deletes: ['Nope000000000000'] })).toBe('COMMAND_ARGS');
    expect(refused({ puts: [], deletes: [doc] })).toBe('COMMAND_ARGS');
    expect(refused({ puts: [rec], deletes: [a] })).toBe('COMMAND_ARGS');
    expect(refused({ puts: [], deletes: [line, line] })).toBe('COMMAND_ARGS');
    expect(store.size).toBe(size);
    expect(store.has(s1 as RecordId)).toBe(true);
  });
});
