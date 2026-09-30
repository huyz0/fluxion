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
