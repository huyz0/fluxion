import { type DocumentFile, validate } from '@fluxion/schema';
import { arbDocument, documentBuilder } from '@fluxion/schema/testing';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createCore } from './bootstrap.js';
import { CORE_COMMANDS } from './builtin-commands.js';
import { CORE_HOOKS } from './hooks.js';
import type { Diff, TxMeta } from './transaction.js';

describe('createCore (M3 final F3)', () => {
  it('FR-EXT-001: the core bootstrap cascades a bound shape delete', () => {
    const b = documentBuilder({ seed: 90 });
    const s = b.screen();
    const a = b.rect(s);
    const c = b.rect(s, { x: 300 });
    const line = b.connect(a, c);
    const core = createCore(b.build());
    // the built-ins are registered, from source core
    expect(core.registries.commands.list().map(([id]) => id)).toEqual(CORE_COMMANDS.map((x) => x.id).sort());
    expect(core.registries.integrityHooks.list().map(([key]) => key)).toEqual(CORE_HOOKS.map(([key]) => key).sort());
    // deleting a bound shape cascades through the hooks instead of failing validation
    const r = core.execute('element.delete', { ids: [a] });
    expect(r.ok, JSON.stringify(!r.ok && r.error)).toBe(true);
    expect(core.store.has(a)).toBe(false);
    expect((core.store.get(line) as { freeSource?: unknown }).freeSource).toBeDefined();
    expect(core.store.members('bindingsByElement', a)).toEqual([]);
    expect(validate(core.store.toDocument()).filter((d) => d.severity === 'error')).toEqual([]);
    expect(core.store.history.undoDepth).toBe(1);
  });

  it('passes store options through and threads command options', () => {
    const b = documentBuilder({ seed: 91 });
    const a = b.rect(b.screen());
    const ro = createCore(b.build(), { policy: 'read-only' });
    expect(ro.execute('element.update', { id: a, fields: { name: 'x' } }).ok).toBe(false);
    const core = createCore(b.build());
    expect(core.execute('element.update', { id: a, fields: { name: 'x' } }, { origin: 'system', mergeKey: 'k' }).ok).toBe(true);
    const metas: TxMeta[] = [];
    core.store.subscribe((_d, m) => metas.push(m));
    expect(core.execute('element.update', { id: a, fields: { name: 'y' } }, { origin: 'system', mergeKey: 'k' }).ok).toBe(true);
    expect(metas.map((m) => [m.origin, m.mergeKey])).toEqual([['system', 'k']]);
    // two system edits under one key merged into one entry
    expect(core.store.history.undoDepth).toBe(1);
  });
});

// NFR-REL-005: document operations are deterministic. The same command sequence on the same document
// gives equal diffs (entry order included), history and document, every run.
// every built-in command, create and binding.set included (M4 cp1 F7): the list is CORE_COMMANDS itself
const COMMANDS = CORE_COMMANDS.map((c) => c.id);
type Op = { readonly command: string; readonly pick: number; readonly value: number };
const arbOps = fc.array(fc.record({ command: fc.constantFrom(...COMMANDS), pick: fc.nat(), value: fc.nat(99) }), { minLength: 1, maxLength: 10 });
const newId = (n: number) => `Det${String(n).padStart(13, '0')}`;

/** The arguments of one generated op against the current state (refusals are part of the model). */
function argsOf(op: Op, n: number, pick: (type: string, kind?: string) => string): unknown {
  const screen = pick('screen');
  const element = pick('element');
  const build: { readonly [id: string]: () => unknown } = {
    'element.create': () => ({
      element: {
        id: newId(n),
        type: 'element',
        kind: 'shape',
        defId: 'basic:rect',
        screenId: screen,
        index: 'a0',
        transform: { x: op.value, y: 0, w: 10, h: 10 },
      },
    }),
    'element.update': () => ({ id: element, fields: { name: `n${op.value}` } }),
    'element.createMany': () => ({
      elements: [0, 1].map((k) => ({
        id: newId(n * 2 + k + 1000),
        type: 'element',
        kind: 'shape',
        defId: 'basic:rect',
        screenId: screen,
        index: `a${k}`,
        transform: { x: op.value + k, y: 0, w: 10, h: 10 },
      })),
    }),
    'element.updateMany': () => ({ updates: [{ id: element, fields: { name: `m${op.value}` } }] }),
    'element.delete': () => ({ ids: [element] }),
    'screen.create': () => ({ screen: { id: newId(n), type: 'screen', index: 'a0' } }),
    'screen.delete': () => ({ id: screen }),
    'screen.reorder': () => ({ id: screen }),
    'binding.set': () => ({
      id: newId(n),
      connectorId: pick('element', 'connector'),
      end: op.value % 2 ? 'source' : 'target',
      elementId: pick('element', 'shape'),
      anchor: { kind: 'auto' },
    }),
    'connector.freeEnd': () => ({ connectorId: pick('element', 'connector'), end: op.value % 2 ? 'source' : 'target', at: { x: op.value, y: 0 } }),
    'document.update': () => ({ fields: { title: `t${op.value}` } }),
    'asset.create': () => ({ asset: { id: newId(n), type: 'asset', hash: 'a'.repeat(64), mime: 'image/png', size: 1, name: 'a.png' } }),
  };
  return build[op.command]?.();
}

/** Serialize a diff with its entry order (Maps keep insertion order; toEqual on Maps would not check it). */
const ordered = (d: Diff) => ({ puts: [...d.puts.entries()], deletes: [...d.deletes.entries()] });

function play(file: DocumentFile, ops: readonly Op[]) {
  const core = createCore(file);
  const diffs: unknown[] = [];
  core.store.subscribe((d, m) => diffs.push([ordered(d), m.label, m.origin]));
  const results = ops.map((op, n) => {
    const pick = (type: string, kind?: string) => {
      const ids = core.store
        .members('byType', type)
        .filter((id) => kind === undefined || (core.store.get(id) as { kind?: string } | undefined)?.kind === kind)
        .sort();
      return ids[op.pick % Math.max(1, ids.length)] ?? 'none';
    };
    const r = core.execute(op.command, argsOf(op, n, pick));
    return r.ok ? 'ok' : r.error.code;
  });
  return { diffs, results, depth: core.store.history.undoDepth, doc: core.store.toDocument() };
}

describe('core determinism (NFR-REL-005, M3 final F4)', () => {
  it('NFR-REL-005: the same command sequence twice gives equal diffs, history and document', () => {
    let committed = 0;
    const committedBy = new Set<string>();
    fc.assert(
      fc.property(arbDocument, arbOps, (file, ops) => {
        const first = play(file, ops);
        const second = play(file, ops);
        expect(second).toEqual(first);
        committed += first.diffs.length;
        ops.forEach((op, i) => {
          if (first.results[i] === 'ok') committedBy.add(op.command);
        });
      }),
    );
    // the property exercised real commits of every built-in, not only refusals (M4 cp1 F7)
    expect(committed).toBeGreaterThan(0);
    expect([...committedBy].sort()).toEqual([...COMMANDS].sort());
  });

  // toEqual on Maps ignores insertion order; the serialized form the property compares does not
  it('the determinism comparison sees diff entry order', () => {
    const b = documentBuilder({ seed: 92 });
    const s = b.screen();
    const x = b.rect(s);
    const y = b.rect(s, { x: 200 });
    const core = createCore(b.build());
    let diff: Diff | undefined;
    core.store.subscribe((d) => {
      diff = d;
    });
    expect(core.execute('element.delete', { ids: [x, y] }).ok).toBe(true);
    const a = ordered(diff as Diff);
    expect(a.deletes.map(([id]) => id).sort()).toEqual([x, y].sort());
    expect({ ...a, deletes: [...a.deletes].reverse() }).not.toEqual(a);
    const asMaps = diff as Diff;
    expect(new Map([...asMaps.deletes].reverse())).toEqual(asMaps.deletes);
  });
});
