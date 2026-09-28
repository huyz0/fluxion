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
const COMMANDS = ['element.update', 'element.delete', 'screen.delete', 'document.update', 'screen.reorder'] as const;
type Op = { readonly command: (typeof COMMANDS)[number]; readonly pick: number; readonly value: number };
const arbOps = fc.array(fc.record({ command: fc.constantFrom(...COMMANDS), pick: fc.nat(), value: fc.nat(99) }), { minLength: 1, maxLength: 10 });

/** Serialize a diff with its entry order (Maps keep insertion order; toEqual on Maps would not check it). */
const ordered = (d: Diff) => ({ puts: [...d.puts.entries()], deletes: [...d.deletes.entries()] });

function play(file: DocumentFile, ops: readonly Op[]) {
  const core = createCore(file);
  const diffs: unknown[] = [];
  core.store.subscribe((d, m) => diffs.push([ordered(d), m.label, m.origin]));
  const ids = (type: string) => core.store.members('byType', type).sort();
  const results = ops.map((op) => {
    const elements = ids('element');
    const screens = ids('screen');
    const element = elements[op.pick % Math.max(1, elements.length)] ?? 'none';
    const screen = screens[op.pick % Math.max(1, screens.length)] ?? 'none';
    const args = {
      'element.update': { id: element, fields: { name: `n${op.value}` } },
      'element.delete': { ids: [element] },
      'screen.delete': { id: screen },
      'document.update': { fields: { title: `t${op.value}` } },
      'screen.reorder': { id: screen },
    }[op.command];
    const r = core.execute(op.command, args);
    return r.ok ? 'ok' : r.error.code;
  });
  return { diffs, results, depth: core.store.history.undoDepth, doc: core.store.toDocument() };
}

describe('core determinism (NFR-REL-005, M3 final F4)', () => {
  it('NFR-REL-005: the same command sequence twice gives equal diffs, history and document', () => {
    let committed = 0;
    fc.assert(
      fc.property(arbDocument, arbOps, (file, ops) => {
        const first = play(file, ops);
        const second = play(file, ops);
        expect(second).toEqual(first);
        committed += first.diffs.length;
      }),
    );
    // the property exercised real commits, not only refusals
    expect(committed).toBeGreaterThan(0);
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
