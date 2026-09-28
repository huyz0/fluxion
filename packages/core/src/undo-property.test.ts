// NFR-REL-003: any sequence of built-in commands, then full undo, restores the initial document
// exactly; redo of everything restores the final one. Runs at the global fast-check run count
// (FC_RUNS; nightly 10 000): the file counts its runs and sets no local count (M3.1 review F2).
import type { AnyRecord, DocumentFile, RecordId } from '@fluxion/schema';
import { arbDocument, documentBuilder } from '@fluxion/schema/testing';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { registerCoreCommands } from './builtin-commands.js';
import { type AnyCommand, type CommandTxOptions, executeCommand } from './commands.js';
import { type IntegrityHook, registerCoreHooks } from './hooks.js';
import { createRegistry } from './registry.js';
import { RecordStore } from './store.js';

const COMMANDS = [
  'element.update',
  'element.delete',
  'element.create',
  'screen.create',
  'screen.delete',
  'screen.reorder',
  'binding.set',
  'document.update',
] as const;
type Command = (typeof COMMANDS)[number];
type Op = { readonly command: Command; readonly a: number; readonly b: number; readonly merge: boolean };
const arbOp: fc.Arbitrary<Op> = fc.record({ command: fc.constantFrom(...COMMANDS), a: fc.nat(), b: fc.nat(), merge: fc.boolean() });
const arbOps = fc.array(arbOp, { minLength: 1, maxLength: 12 });

/** What argument builders see: the op, its position, and lookups in the current state. */
type Pick = {
  readonly op: Op;
  readonly n: number;
  readonly element?: string;
  readonly screen?: string;
  pick(type: string, n: number, kind?: string): string | undefined;
};
const newId = (n: number) => `Gen${String(n).padStart(13, '0')}`;

/** Arguments per command against the current state; refused commands are part of the model. */
const ARGS: Readonly<Record<Command, (p: Pick) => unknown>> = {
  'element.update': ({ op, element }) => ({ id: element ?? 'none', fields: { name: `n${op.b % 5}` } }),
  'element.delete': ({ element }) => ({ ids: [element ?? 'none'] }),
  'element.create': ({ op, n, screen }) => ({
    element: {
      id: newId(n),
      type: 'element',
      kind: 'shape',
      defId: 'basic:rect',
      screenId: screen ?? 'none',
      index: 'a0',
      transform: { x: op.b, y: 0, w: 10, h: 10 },
    },
  }),
  'screen.create': ({ n }) => ({ screen: { id: newId(n), type: 'screen', index: 'a0' } }),
  'screen.delete': ({ screen }) => ({ id: screen ?? 'none' }),
  'screen.reorder': ({ op, screen, pick }) => {
    const after = pick('screen', op.b);
    return after && after !== screen ? { id: screen ?? 'none', after } : { id: screen ?? 'none' };
  },
  'binding.set': ({ op, n, pick }) => ({
    id: newId(n),
    connectorId: pick('element', op.a, 'connector') ?? 'none',
    end: op.b % 2 ? 'source' : 'target',
    elementId: pick('element', op.b, 'shape') ?? 'none',
    anchor: { kind: 'auto' },
  }),
  'document.update': ({ op }) => ({ fields: { title: `t${op.b % 5}` } }),
};

type Built = { readonly store: RecordStore; run(op: Op, n: number): void; runAll(ops: readonly Op[]): void };

function build(file: DocumentFile): Built {
  const hooks = createRegistry<string, IntegrityHook>('integrityHooks');
  registerCoreHooks(hooks);
  const store = new RecordStore(file, { hooks });
  const commands = createRegistry<string, AnyCommand>('commands');
  registerCoreCommands(commands);
  const pick = (type: string, n: number, kind?: string): string | undefined => {
    const ids = store.members('byType', type).filter((id) => kind === undefined || (store.get(id) as { kind?: string }).kind === kind);
    return ids[n % Math.max(1, ids.length)];
  };
  const run = (op: Op, n: number): void => {
    const element = pick('element', op.a);
    const screen = pick('screen', op.a);
    const args = ARGS[op.command]({ op, n, pick, ...(element ? { element } : {}), ...(screen ? { screen } : {}) });
    const options: CommandTxOptions = op.merge ? { mergeKey: op.command } : {};
    executeCommand(commands, { store, options }, op.command, args);
  };
  return {
    store,
    run,
    runAll: (ops) => {
      for (const [n, op] of ops.entries()) run(op, n);
    },
  };
}

describe('undo exactness over command sequences (NFR-REL-003)', () => {
  it('NFR-REL-003: any sequence then full undo restores initial', () => {
    let runs = 0;
    fc.assert(
      fc.property(arbDocument, arbOps, (file: DocumentFile, ops: Op[]) => {
        runs++;
        const { store, runAll } = build(file);
        const initial = store.toDocument();
        runAll(ops);
        while (store.history.canUndo()) expect(store.history.undo().ok).toBe(true);
        expect(store.toDocument()).toEqual(initial);
      }),
    );
    expect(runs).toBe(fc.readConfigureGlobal().numRuns);
  });

  it('NFR-REL-003: redo all restores the final document', () => {
    let runs = 0;
    fc.assert(
      fc.property(arbDocument, arbOps, (file: DocumentFile, ops: Op[]) => {
        runs++;
        const { store, runAll } = build(file);
        runAll(ops);
        const final = store.toDocument();
        // a failing undo fails the property instead of looping (M3.21 review F1)
        while (store.history.canUndo()) expect(store.history.undo().ok).toBe(true);
        while (store.history.canRedo()) expect(store.history.redo().ok).toBe(true);
        expect(store.toDocument()).toEqual(final);
        expect(Object.keys(final.records as Record<string, AnyRecord>).length).toBeGreaterThan(0);
      }),
    );
    expect(runs).toBe(fc.readConfigureGlobal().numRuns);
  });

  it('the command model commits most of the time (it is not all refusals)', () => {
    const b = documentBuilder({ seed: 7 });
    const screen = b.screen();
    const x = b.rect(screen);
    b.connect(x, b.rect(screen, { x: 300 }));
    const { store, runAll } = build(b.build());
    runAll(COMMANDS.map((command, n) => ({ command, a: n, b: n + 1, merge: false })));
    expect(store.history.undoDepth).toBeGreaterThanOrEqual(6);
    expect(store.has('none' as RecordId)).toBe(false);
  });
});
