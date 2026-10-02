import type { AnyRecord, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { CORE_COMMANDS, registerCoreCommands } from './builtin-commands.js';
import { type AnyCommand, executeCommand } from './commands.js';
import { type IntegrityHook, registerCoreHooks } from './hooks.js';
import { createRegistry } from './registry.js';
import { RecordStore } from './store.js';
import type { Diff } from './transaction.js';

function setup() {
  const b = documentBuilder({ seed: 40 });
  const s1 = b.screen();
  const s2 = b.screen();
  const s3 = b.screen();
  const a = b.rect(s1);
  const c = b.rect(s1, { x: 300 });
  const line = b.connect(a, c);
  const hooks = createRegistry<string, IntegrityHook>('integrityHooks');
  registerCoreHooks(hooks);
  const store = new RecordStore(b.build(), { hooks });
  const commands = createRegistry<string, AnyCommand>('commands');
  expect(registerCoreCommands(commands)).toEqual([]);
  const diffs: Diff[] = [];
  store.subscribe((d) => diffs.push(d));
  const run = (id: string, args: unknown) => executeCommand(commands, { store }, id, args);
  return { store, run, diffs, s1, s2, s3, a, c, line };
}

const order = (store: RecordStore) =>
  store
    .members('byType', 'screen')
    .map((id) => [id, String((store.get(id) as { index: string }).index)] as const)
    .sort(([, x], [, y]) => (x < y ? -1 : 1))
    .map(([id]) => id);

describe('built-in record commands (FR-EXT-001)', () => {
  it('FR-EXT-001: the built-ins are registered through the registry as source core', () => {
    const commands = createRegistry<string, AnyCommand>('commands');
    expect(registerCoreCommands(commands)).toEqual([]);
    expect(commands.list().map(([id]) => id)).toEqual([
      'asset.create',
      'binding.set',
      'connector.freeEnd',
      'document.update',
      'element.align',
      'element.create',
      'element.createMany',
      'element.delete',
      'element.distribute',
      'element.group',
      'element.ungroup',
      'element.update',
      'element.updateMany',
      'element.zOrder',
      'screen.create',
      'screen.delete',
      'screen.duplicate',
      'screen.move',
      'screen.rename',
      'screen.reorder',
      'screen.setFormat',
      'screen.setHidden',
      'screen.setNotes',
      'screen.setSection',
      'section.create',
      'section.delete',
      'section.rename',
      'section.reorder',
      'section.setCollapsed',
    ]);
    expect(CORE_COMMANDS.every((c) => commands.source(c.id) === 'core')).toBe(true);
    // a plugin holding a built-in id is reported, not silently skipped (M3.14 review F1)
    const taken = createRegistry<string, AnyCommand>('commands');
    taken.register('element.update', CORE_COMMANDS[0] as AnyCommand, 'acme');
    expect(registerCoreCommands(taken).map((d) => d.code)).toEqual(['FLX_REGISTRY_DUPLICATE']);
    const hooks = createRegistry<string, IntegrityHook>('integrityHooks');
    hooks.register('core:1-screens', () => {}, 'acme');
    expect(registerCoreHooks(hooks).map((d) => d.code)).toEqual(['FLX_REGISTRY_DUPLICATE']);
  });

  it('FR-DOC-010: screen.reorder writes exactly one record', () => {
    const { store, run, diffs, s1, s2, s3 } = setup();
    expect(order(store)).toEqual([s1, s2, s3]);
    expect(run('screen.reorder', { id: s1, after: s3 }).ok).toBe(true);
    expect(order(store)).toEqual([s2, s3, s1]);
    expect(run('screen.reorder', { id: s1 }).ok).toBe(true);
    expect(order(store)).toEqual([s1, s2, s3]);
    expect(run('screen.reorder', { id: s3, after: s1 }).ok).toBe(true);
    expect(order(store)).toEqual([s1, s3, s2]);
    for (const d of diffs) {
      expect(d.puts.size).toBe(1);
      expect(d.deletes.size).toBe(0);
    }
    const missing = run('screen.reorder', { id: s1, after: 'nope' });
    expect(!missing.ok && missing.error.code).toBe('COMMAND_ARGS');
  });

  it('element create, update and delete (with cascades through the hooks)', () => {
    const { store, run, s1, a, line } = setup();
    const element = {
      id: 'NewElementNewEl1',
      type: 'element',
      kind: 'shape',
      defId: 'basic:rect',
      screenId: s1,
      index: 'a9',
      transform: { x: 0, y: 0, w: 5, h: 5 },
    };
    expect(run('element.create', { element }).ok).toBe(true);
    expect(store.get(element.id as RecordId)).toEqual(element);
    expect(run('element.update', { id: a, fields: { name: 'A' } }).ok).toBe(true);
    expect((store.get(a) as { name?: string }).name).toBe('A');
    expect(run('element.delete', { ids: [a] }).ok).toBe(true);
    expect(store.has(a)).toBe(false);
    expect((store.get(line) as { freeSource?: unknown }).freeSource).toBeDefined();
    // an invalid element is refused by the transaction, not the arguments
    const bad = run('element.create', { element: { id: 'BadBadBadBadBad1', type: 'element', kind: 'shape' } });
    expect(!bad.ok && bad.error.code).toBe('TX_INVALID');
  });

  it('create commands refuse an existing id; update and delete refuse another record type (M3.17 review)', () => {
    const { store, run, s1, a, line } = setup();
    const before = store.toDocument();
    const clash = { id: a, type: 'element', kind: 'shape', defId: 'basic:rect', screenId: s1, index: 'a9', transform: { x: 0, y: 0, w: 1, h: 1 } };
    const refusals = [
      [run('element.create', { element: clash }), '/args/element/id'],
      [run('screen.create', { screen: { id: s1, type: 'screen', index: 'a9' } }), '/args/screen/id'],
      [run('element.update', { id: s1, fields: { name: 'x' } }), '/args/id'],
      [run('element.delete', { ids: [a, s1] }), '/args/ids/1'],
      [run('screen.delete', { id: a }), '/args/id'],
      [run('screen.reorder', { id: a }), '/args/id'],
      [run('binding.set', { id: a, connectorId: line, end: 'target', elementId: s1, anchor: { kind: 'auto' } }), '/args/elementId'],
    ] as const;
    for (const [r, path] of refusals) {
      expect(!r.ok && r.error.code).toBe('COMMAND_ARGS');
      expect(!r.ok && r.error.diagnostics).toEqual([expect.objectContaining({ code: 'FLX_COMMAND_ARGS', path })]);
    }
    expect(store.toDocument()).toEqual(before);
  });

  it('FR-EXT-001: element.update with an identity field in fields returns a diagnostic', () => {
    const { store, run, a, s2 } = setup();
    const before = store.toDocument();
    for (const [id, cmd, extra] of [
      [a, 'element.update', { type: 'screen' }],
      [a, 'element.update', { id: 'Other' }],
      [undefined, 'document.update', { type: 'screen' }],
    ] as const) {
      const r = run(cmd, { ...(id ? { id } : {}), fields: { name: 'x', ...extra } });
      expect(!r.ok && r.error.code).toBe('COMMAND_ARGS');
      expect(!r.ok && r.error.diagnostics).toEqual([expect.objectContaining({ code: 'FLX_COMMAND_ARGS', path: `/args/fields/${Object.keys(extra)[0]}` })]);
    }
    // an unknown `after` is a diagnostic too (M3 cp1 F4)
    const after = run('screen.reorder', { id: s2, after: 'Gone' });
    expect(!after.ok && after.error.diagnostics).toEqual([expect.objectContaining({ code: 'FLX_COMMAND_ARGS', path: '/args/after' })]);
    expect(store.toDocument()).toEqual(before);
  });

  it('document.update on a store without a document is refused, not thrown', () => {
    const b = documentBuilder({ seed: 41 });
    b.screen();
    const file = b.build();
    const records = Object.fromEntries(Object.entries(file.records).filter(([, r]) => r.type !== 'document'));
    const store = new RecordStore({ ...file, records }, { validate: false });
    const commands = createRegistry<string, AnyCommand>('commands');
    registerCoreCommands(commands);
    const r = executeCommand(commands, { store }, 'document.update', { fields: { title: 'x' } });
    expect(!r.ok && r.error.diagnostics).toEqual([expect.objectContaining({ code: 'FLX_COMMAND_ARGS', path: '/args' })]);
    expect(!r.ok && r.error.message.startsWith('document.update: ')).toBe(true);
  });

  it('binding.set refuses a new binding id that is taken', () => {
    const { store, run, a, c, line } = setup();
    expect(run('element.delete', { ids: [c] }).ok).toBe(true); // the target end is free now
    const taken = run('binding.set', { id: a, connectorId: line, end: 'target', elementId: a, anchor: { kind: 'auto' } });
    expect(!taken.ok && taken.error.diagnostics).toEqual([expect.objectContaining({ path: '/args/id' })]);
    expect(store.get(a)?.type).toBe('element');
  });

  it('screen create and delete, document update', () => {
    const { store, run, s2 } = setup();
    expect(run('screen.create', { screen: { id: 'ScreenScreenScr1', type: 'screen', index: 'a9' } }).ok).toBe(true);
    expect(store.has('ScreenScreenScr1' as RecordId)).toBe(true);
    expect(run('screen.delete', { id: s2 }).ok).toBe(true);
    expect(store.has(s2)).toBe(false);
    expect(run('document.update', { fields: { title: 'Renamed' } }).ok).toBe(true);
    const doc = store.members('byType', 'document')[0] as RecordId;
    expect((store.get(doc) as { title?: string }).title).toBe('Renamed');
  });

  it('binding.set re-points a bound end and binds a free end, clearing its free point', () => {
    const { store, run, a, c, line } = setup();
    const bindingOf = (end: string) =>
      store
        .members('bindingsByElement', line)
        .map((id) => store.get(id) as AnyRecord & { end: string; elementId: string })
        .find((b) => b.end === end);
    expect(run('binding.set', { id: 'UnusedUnusedUnu1', connectorId: line, end: 'target', elementId: a, anchor: { kind: 'auto' } }).ok).toBe(true);
    expect(bindingOf('target')?.elementId).toBe(a);
    expect(store.members('byType', 'binding')).toHaveLength(2);
    expect(run('element.delete', { ids: [c] }).ok).toBe(true); // nothing bound to c now; no-op for bindings
    expect(run('binding.set', { id: 'SourceSourceSrc1', connectorId: line, end: 'source', elementId: a, anchor: { kind: 'floating' } }).ok).toBe(true);
    expect(bindingOf('source')?.elementId).toBe(a);
    expect((store.get(line) as { freeSource?: unknown }).freeSource).toBeUndefined();
  });

  it('FR-EXT-001: an unknown id argument returns COMMAND_ARGS', () => {
    const { store, run, s1 } = setup();
    const before = store.toDocument();
    const cases = [
      ['element.update', { id: 'MissingMissing01', fields: { name: 'x' } }, '/args/id'],
      ['element.delete', { ids: ['MissingMissing01'] }, '/args/ids/0'],
      ['screen.delete', { id: 'MissingMissing01' }, '/args/id'],
      ['screen.reorder', { id: s1, after: 'MissingMissing01' }, '/args/after'],
      // a screen cannot follow itself: an argument error too (M3 final F5)
      ['screen.reorder', { id: s1, after: s1 }, '/args/after'],
    ] as const;
    for (const [command, args, path] of cases) {
      const r = run(command, args);
      expect(!r.ok && r.error.code, command).toBe('COMMAND_ARGS');
      expect(!r.ok && r.error.diagnostics).toEqual([expect.objectContaining({ code: 'FLX_COMMAND_ARGS', severity: 'error', path })]);
    }
    expect(store.toDocument()).toEqual(before);
  });

  it('screen.reorder between equal neighbour keys names the duplicate index', () => {
    const b = documentBuilder({ seed: 41 });
    const [s1, s2, s3] = [b.screen(), b.screen(), b.screen()];
    const file = b.build();
    // two screens share a key (a document with FLX_INDEX_DUPLICATE loads; the store tolerates known errors)
    const records = { ...file.records, [s2]: { ...(file.records[s2] as AnyRecord), index: (file.records[s1] as { index: string }).index } };
    const store = new RecordStore({ ...file, records } as typeof file);
    const commands = createRegistry<string, AnyCommand>('commands');
    registerCoreCommands(commands);
    const r = executeCommand(commands, { store }, 'screen.reorder', { id: s3, after: s1 });
    expect(!r.ok && r.error.code).toBe('TX_INVALID');
    expect(!r.ok && r.error.diagnostics).toEqual([expect.objectContaining({ code: 'FLX_INDEX_DUPLICATE', severity: 'warning', path: `/records/${s2}/index` })]);
    // a malformed key is named on the neighbour that holds it, not the valid one (M4.4 review F1)
    const bad = { ...file.records, [s1]: { ...(file.records[s1] as AnyRecord), index: '!!' } };
    const broken = new RecordStore({ ...file, records: bad } as typeof file);
    const m = executeCommand(commands, { store: broken }, 'screen.reorder', { id: s3, after: s1 });
    expect(!m.ok && m.error.diagnostics).toEqual([expect.objectContaining({ code: 'FLX_SCHEMA_INVALID', severity: 'error', path: `/records/${s1}/index` })]);
  });

  it('FR-EXT-001: each built-in is titled command.<id> and commits one transaction labelled with its id', () => {
    for (const command of CORE_COMMANDS) {
      expect(command.title.id).toBe(`command.${command.id}`);
      expect(command.title.defaultMessage).not.toBe('');
    }
    const { store, run, s1, s2, a, c, line } = setup();
    const labels: string[] = [];
    store.subscribe((_d, meta) => labels.push(meta.label));
    const element = {
      id: 'LabelLabelLabel1',
      type: 'element',
      kind: 'shape',
      defId: 'basic:rect',
      screenId: s1,
      index: 'a9',
      transform: { x: 0, y: 0, w: 5, h: 5 },
    };
    const steps: Array<[string, unknown]> = [
      ['element.create', { element }],
      ['element.update', { id: a, fields: { name: 'A' } }],
      ['element.createMany', { elements: [{ ...element, id: 'LabelManyLabelM1', index: 'a8' }] }],
      ['element.updateMany', { updates: [{ id: a, fields: { name: 'B' } }] }],
      ['binding.set', { id: 'LabelBindingLab1', connectorId: line, end: 'target', elementId: element.id, anchor: { kind: 'auto' } }],
      ['connector.freeEnd', { connectorId: line, end: 'source', at: { x: 1, y: 2 } }],
      ['element.delete', { ids: [c] }],
      ['screen.create', { screen: { id: 'LabelScreenLabe1', type: 'screen', index: 'a9' } }],
      ['screen.reorder', { id: s1, after: s2 }],
      ['screen.delete', { id: 'LabelScreenLabe1' }],
      ['document.update', { fields: { title: 'T' } }],
    ];
    for (const [id, args] of steps) {
      const r = run(id, args);
      expect(r.ok, `${id}: ${JSON.stringify(!r.ok && r.error)}`).toBe(true);
    }
    expect(labels).toEqual(steps.map(([id]) => id));
  });

  it('FR-EXT-001: a refused built-in names itself in its failure message and explains every diagnostic', () => {
    const { run, s1, s2, a, c, line } = setup();
    const clash = { id: a, type: 'element', kind: 'shape', defId: 'basic:rect', screenId: s1, index: 'a9', transform: { x: 0, y: 0, w: 1, h: 1 } };
    const refusals: Array<[string, unknown]> = [
      ['element.create', { element: clash }],
      ['element.update', { id: s1, fields: { name: 'x' } }],
      ['element.update', { id: a, fields: { type: 'screen' } }],
      ['element.createMany', { elements: [clash] }],
      [
        'element.createMany',
        {
          elements: [
            { ...clash, id: 'TwiceTwiceTwice1' },
            { ...clash, id: 'TwiceTwiceTwice1' },
          ],
        },
      ],
      ['element.updateMany', { updates: [{ id: s1, fields: { name: 'x' } }] }],
      ['element.delete', { ids: [s1] }],
      ['screen.create', { screen: { id: s1, type: 'screen', index: 'a9' } }],
      ['screen.delete', { id: a }],
      ['screen.reorder', { id: a }],
      ['screen.reorder', { id: s1, after: s1 }],
      ['binding.set', { id: 'FreshFreshFresh1', connectorId: line, end: 'target', elementId: s2, anchor: { kind: 'auto' } }],
      ['connector.freeEnd', { connectorId: s1, end: 'source', at: { x: 1, y: 2 } }],
      ['document.update', { fields: { id: 'x' } }],
    ];
    // a new binding id that is taken (checked only when the end is not bound yet)
    expect(run('element.delete', { ids: [c] }).ok).toBe(true);
    refusals.push(['binding.set', { id: a, connectorId: line, end: 'target', elementId: a, anchor: { kind: 'auto' } }]);
    for (const [id, args] of refusals) {
      const r = run(id, args);
      expect(r.ok, id).toBe(false);
      if (r.ok) continue;
      expect(r.error.message.startsWith(`${id}: `), r.error.message).toBe(true);
      expect(r.error.diagnostics.length, id).toBeGreaterThan(0);
      for (const d of r.error.diagnostics) expect(d.message, id).not.toBe('');
    }
    // the connector argument is named in the refusal of connector.freeEnd
    const freeing = run('connector.freeEnd', { connectorId: s1, end: 'source', at: { x: 1, y: 2 } });
    expect(!freeing.ok && freeing.error.diagnostics[0]?.path).toBe('/args/connectorId');
    // an identity field is named in its diagnostic
    const identity = run('element.update', { id: a, fields: { id: 'x' } });
    expect(!identity.ok && identity.error.diagnostics[0]?.message).toContain('"id"');
  });

  it('FR-EXT-001: binding.set checks its connector argument and the anchor kind', () => {
    const { store, run, a, line } = setup();
    const before = store.toDocument();
    const missing = run('binding.set', { id: 'FreshFreshFresh1', connectorId: 'MissingMissing01', end: 'target', elementId: a, anchor: { kind: 'auto' } });
    expect(!missing.ok && missing.error.diagnostics).toEqual([expect.objectContaining({ code: 'FLX_COMMAND_ARGS', path: '/args/connectorId' })]);
    const kindless = run('binding.set', { id: 'FreshFreshFresh1', connectorId: line, end: 'target', elementId: a, anchor: {} });
    expect(!kindless.ok && kindless.error.code).toBe('COMMAND_ARGS');
    expect(!kindless.ok && kindless.error.diagnostics).toEqual([expect.objectContaining({ code: 'FLX_COMMAND_ARGS', path: '/args/anchor/kind' })]);
    expect(store.toDocument()).toEqual(before);
  });

  it('FR-EXT-001: binding.set clears the free point of the end it binds and only that end', () => {
    const b = documentBuilder({ seed: 42 });
    const s = b.screen();
    const [a, c, e] = [b.rect(s), b.rect(s, { x: 300 }), b.rect(s, { x: 600 })];
    const line = b.connect(a, c);
    const hooks = createRegistry<string, IntegrityHook>('integrityHooks');
    registerCoreHooks(hooks);
    const store = new RecordStore(b.build(), { hooks });
    const commands = createRegistry<string, AnyCommand>('commands');
    registerCoreCommands(commands);
    const run = (id: string, args: unknown) => executeCommand(commands, { store }, id, args);
    const ends = () => {
      const r = store.get(line) as { freeSource?: unknown; freeTarget?: unknown };
      return [r.freeSource !== undefined, r.freeTarget !== undefined];
    };
    expect(run('element.delete', { ids: [c] }).ok).toBe(true);
    expect(ends()).toEqual([false, true]);
    expect(run('binding.set', { id: 'TargetTargetTar1', connectorId: line, end: 'target', elementId: e, anchor: { kind: 'auto' } }).ok).toBe(true);
    expect(ends()).toEqual([false, false]);
    expect(run('element.delete', { ids: [a] }).ok).toBe(true);
    expect(ends()).toEqual([true, false]);
    expect(run('binding.set', { id: 'SourceSourceSrc1', connectorId: line, end: 'source', elementId: e, anchor: { kind: 'auto' } }).ok).toBe(true);
    expect(ends()).toEqual([false, false]);
    expect(store.members('bindingsByElement', line)).toHaveLength(2);
  });

  it('FR-DOC-010: screen.reorder names a malformed next neighbour, not the valid screen before it', () => {
    const b = documentBuilder({ seed: 43 });
    const [s1, s2, s3] = [b.screen(), b.screen(), b.screen()];
    const file = b.build();
    const at = (id: RecordId, index: string) => ({ ...(file.records[id] as AnyRecord), index });
    // order: s1 (a0), s3 (a1), s2 (b!!, malformed)
    const records = { ...file.records, [s1]: at(s1, 'a0'), [s3]: at(s3, 'a1'), [s2]: at(s2, 'b!!') };
    const store = new RecordStore({ ...file, records } as typeof file, { validate: false });
    const commands = createRegistry<string, AnyCommand>('commands');
    registerCoreCommands(commands);
    const r = executeCommand(commands, { store }, 'screen.reorder', { id: s1, after: s3 });
    expect(!r.ok && r.error.code).toBe('TX_INVALID');
    expect(!r.ok && r.error.message.startsWith('screen.reorder: ')).toBe(true);
    expect(!r.ok && r.error.diagnostics).toEqual([expect.objectContaining({ code: 'FLX_SCHEMA_INVALID', path: `/records/${s2}/index` })]);
  });

  it('FR-DOC-010: a screen without an index sorts first, before every valid key', () => {
    const b = documentBuilder({ seed: 44 });
    const [bare, low, moved] = [b.screen(), b.screen(), b.screen()];
    const file = b.build();
    const { index: _dropped, ...unindexed } = file.records[bare] as AnyRecord & { index: string };
    // `R000000001` is a valid key far below `a0`
    const records = { ...file.records, [bare]: unindexed, [low]: { ...(file.records[low] as AnyRecord), index: 'R000000001' } };
    const store = new RecordStore({ ...file, records } as typeof file, { validate: false });
    const commands = createRegistry<string, AnyCommand>('commands');
    registerCoreCommands(commands);
    // moving `moved` first puts it before the index-less screen, whose missing key has nothing before it
    const r = executeCommand(commands, { store }, 'screen.reorder', { id: moved });
    expect(!r.ok && r.error.code).toBe('TX_INVALID');
    expect(!r.ok && r.error.diagnostics).toEqual([expect.objectContaining({ code: 'FLX_SCHEMA_INVALID', path: `/records/${bare}/index` })]);
    // with a valid first screen instead, moving first succeeds
    const valid = new RecordStore({ ...file, records: { ...records, [bare]: { ...unindexed, index: 'a5' } } } as typeof file, { validate: false });
    expect(executeCommand(commands, { store: valid }, 'screen.reorder', { id: moved }).ok).toBe(true);
  });
});
