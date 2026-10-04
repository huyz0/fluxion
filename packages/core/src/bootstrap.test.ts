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
function argsOf(op: Op, n: number, pick: (type: string, kind?: string) => string, shapes: () => string[]): unknown {
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
    'screen.rename': () => ({ id: screen, name: `s${op.value}` }),
    'screen.setFormat': () => ({ id: screen, format: { kind: 'fixed', size: { w: 800 + op.value, h: 600 } } }),
    'section.create': () => ({ id: newId(n + 900), name: `sec${op.value}` }),
    'section.rename': () => ({ id: pick('section'), name: `sec${op.value}` }),
    'section.setCollapsed': () => ({ id: pick('section'), collapsed: op.value % 2 === 1 }),
    'section.reorder': () => ({ id: pick('section') }),
    'section.delete': () => ({ id: pick('section') }),
    'screen.setSection': () => ({ id: screen, sectionId: pick('section') }),
    'screen.move': () => ({ id: screen, sectionId: pick('section') }),
    'screen.setNotes': () => ({ id: screen, notes: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `n${op.value}` }] }] } }),
    'screen.setHidden': () => ({ id: screen, hidden: op.value % 2 === 1 }),
    'screen.duplicate': () => ({ id: screen, newId: newId(n + 700), ids: Object.fromEntries(shapes().map((x, k) => [x, newId(n + 800 + k)])) }),
    'binding.set': () => ({
      id: newId(n),
      connectorId: pick('element', 'connector'),
      end: op.value % 2 ? 'source' : 'target',
      elementId: pick('element', 'shape'),
      anchor: { kind: 'auto' },
    }),
    'connector.freeEnd': () => ({ connectorId: pick('element', 'connector'), end: op.value % 2 ? 'source' : 'target', at: { x: op.value, y: 0 } }),
    'element.group': () => ({ ids: [pick('element', 'shape')], groupId: newId(n + 500) }),
    'element.ungroup': () => ({ ids: [pick('element', 'group')] }),
    'element.align': () => ({ ids: [pick('element', 'shape')], mode: 'left', to: 'screen' }),
    'element.distribute': () => ({ ids: shapes(), axis: 'horizontal', by: 'gaps', gap: 10 }),
    'element.zOrder': () => ({ ids: [pick('element', 'shape')], to: op.value % 2 ? 'front' : 'back' }),
    'document.update': () => ({ fields: { title: `t${op.value}` } }),
    'document.setTheme': () => ({ theme: { name: `T${op.value}`, tokens: { color: { text: { $type: 'color', $value: '#000000' } } } } }),
    'screen.setThemeOverride': () => ({ id: screen, theme: { name: `T${op.value}`, tokens: { color: { text: { $type: 'color', $value: '#000000' } } } } }),
    'document.updateMeta': () => ({ fields: { description: `d${op.value}` }, modified: `2026-01-0${(op.value % 9) + 1}T00:00:00Z` }),
    'asset.update': () => ({ id: pick('asset'), fields: { name: `n${op.value}.png` } }),
    'asset.delete': () => ({ ids: [pick('asset')] }),
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
    const shapes = () =>
      core.store
        .members('byType', 'element')
        .filter((id) => (core.store.get(id) as { kind?: string } | undefined)?.kind === 'shape')
        .sort();
    const r = core.execute(op.command, argsOf(op, n, pick, shapes));
    return r.ok ? 'ok' : r.error.code;
  });
  return { diffs, results, depth: core.store.history.undoDepth, doc: core.store.toDocument() };
}

/** A document with a screen and two shapes, and the ops that group one, dissolve the group, align and distribute (each commits). */
const GROUPED_EXAMPLE: DocumentFile = (() => {
  const b = documentBuilder({ seed: 93 });
  const screen = b.screen();
  b.rect(screen);
  b.rect(screen, { x: 300 });
  return b.build();
})();
const GROUP_THEN_UNGROUP: Op[] = [
  { command: 'element.group', pick: 0, value: 1 },
  { command: 'element.ungroup', pick: 0, value: 1 },
  { command: 'element.align', pick: 0, value: 1 },
  { command: 'element.distribute', pick: 0, value: 1 },
  { command: 'element.zOrder', pick: 0, value: 1 },
  { command: 'screen.rename', pick: 0, value: 1 },
  { command: 'screen.setFormat', pick: 0, value: 1 },
  { command: 'screen.setNotes', pick: 0, value: 1 },
  { command: 'screen.setHidden', pick: 0, value: 1 },
  { command: 'screen.duplicate', pick: 0, value: 1 },
];

/** A document with two screens, two shapes and a connector between them, and one op for each of the other commands. */
const MISC_EXAMPLE: DocumentFile = (() => {
  const b = documentBuilder({ seed: 94 });
  const first = b.screen();
  b.screen();
  const left = b.rect(first, { x: 0 });
  const right = b.rect(first, { x: 300 });
  b.connect(left, right);
  return b.build();
})();
/** The same, with a section on the first screen, and one op for each section command. */
const SECTION_EXAMPLE: DocumentFile = (() => {
  const file = MISC_EXAMPLE;
  const first = Object.values(file.records).find((r) => r.type === 'screen') as { id: string };
  const records: Record<string, unknown> = { ...file.records, SectionAAAA00001: { id: 'SectionAAAA00001', type: 'section', name: 'A', index: 'a0' } };
  records[first.id] = { ...(records[first.id] as object), sectionId: 'SectionAAAA00001' };
  return { ...file, records } as unknown as DocumentFile;
})();
const SECTION_OPS: Op[] = [
  'section.create',
  'section.rename',
  'section.setCollapsed',
  'section.reorder',
  'screen.setSection',
  'screen.move',
  'section.delete',
].map((command) => ({
  command,
  pick: 0,
  value: 1,
}));
const MISC_OPS: Op[] = [
  'element.create',
  'element.createMany',
  'element.update',
  'element.updateMany',
  'binding.set',
  'connector.freeEnd',
  'element.delete',
  'screen.create',
  'screen.reorder',
  'screen.delete',
  'document.update',
  'document.setTheme',
  'screen.setThemeOverride',
  'document.updateMeta',
  'asset.create',
  'asset.update',
  'asset.delete',
].map((command) => ({ command, pick: 0, value: 1 }));

describe('core determinism (NFR-REL-005, M3 final F4)', () => {
  it('NFR-REL-005: the same command sequence twice gives equal diffs, history and document', () => {
    // the guaranteed example really commits both of its ops
    expect(new Set(play(MISC_EXAMPLE, MISC_OPS).results)).toEqual(new Set(['ok']));
    expect(new Set(play(SECTION_EXAMPLE, SECTION_OPS).results)).toEqual(new Set(['ok']));
    expect(play(GROUPED_EXAMPLE, GROUP_THEN_UNGROUP).results).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok']);
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
      // generated documents hold no group, so element.ungroup commits only after an element.group in the same list, by
      // chance: this example guarantees both commit (M8.25), whatever the generators draw
      {
        examples: [
          [GROUPED_EXAMPLE, GROUP_THEN_UNGROUP],
          [MISC_EXAMPLE, MISC_OPS],
          [SECTION_EXAMPLE, SECTION_OPS],
        ],
      },
    );
    // the property exercised real commits of every built-in, not only refusals (M4 cp1 F7)
    expect(committed).toBeGreaterThan(0);
    expect([...committedBy].sort()).toEqual([...COMMANDS].sort());
  }, 60_000); // a property over generated documents: a slow runner (macOS CI took over the 5 s default) needs room

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
