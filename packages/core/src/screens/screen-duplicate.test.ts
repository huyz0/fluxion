import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { expect, it } from 'vitest';
import { registerCoreCommands } from '../builtin-commands.js';
import { type AnyCommand, executeCommand } from '../commands.js';
import { type IntegrityHook, registerCoreHooks } from '../hooks.js';
import { createRegistry } from '../registry.js';
import { RecordStore } from '../store.js';
import { screenRecordsToCopy } from './screen-commands.js';

function setup(includeExternal = false) {
  const b = documentBuilder({ seed: 612 });
  const screen = b.screen();
  const other = b.screen();
  const left = b.rect(screen);
  const right = b.rect(screen, { x: 300 });
  const outside = b.rect(other);
  const internal = b.connect(left, right);
  const outgoing = includeExternal ? b.connect(left, outside) : undefined;
  const incoming = includeExternal ? b.connect(outside, right) : undefined;
  const hooks = createRegistry<string, IntegrityHook>('integrityHooks');
  registerCoreHooks(hooks);
  const store = new RecordStore(b.build(), { hooks });
  const commands = createRegistry<string, AnyCommand>('commands');
  registerCoreCommands(commands);
  const run = (command: string, args: unknown) => executeCommand(commands, { store }, command, args);
  const get = (id: string) => store.get(id as RecordId) as unknown as Record<string, unknown>;
  return { store, run, get, screen, other, left, right, internal, incoming, outgoing };
}

function duplicate(t: ReturnType<typeof setup>) {
  const selected = screenRecordsToCopy(t.store, t.screen);
  const ids = Object.fromEntries(selected.map((id, i) => [id, `CopyRecord${String(i).padStart(6, '0')}`]));
  const before = t.store.toDocument();
  const writes: string[][] = [];
  const unsubscribe = t.store.subscribe((diff) => writes.push([...diff.puts.keys()]));
  const result = t.run('screen.duplicate', { id: t.screen, newId: 'DuplicateScreen001', ids });
  unsubscribe();
  expect(result.ok, JSON.stringify(result)).toBe(true);
  expect(writes).toEqual([['DuplicateScreen001', ...selected.map((id) => ids[id])]]);
  return { ids, before, selected, screen: 'DuplicateScreen001' };
}

it('FR-SCR-002, FR-DOC-007: duplicate preserves metadata, nested parents and namelessness; undo is exact', () => {
  const t = setup();
  const metadata = { label: 'Left', role: 'service', tags: ['edge'], owner: { team: 'platform' } };
  expect(t.run('element.update', { id: t.left, fields: { semantic: { slug: 'left', ...metadata } } }).ok).toBe(true);
  expect(t.run('element.update', { id: t.right, fields: { semantic: { slug: 'right' } } }).ok).toBe(true);
  expect(t.run('element.group', { ids: [t.left, t.right], groupId: 'InnerGroup000001' }).ok).toBe(true);
  expect(t.run('element.group', { ids: ['InnerGroup000001', t.internal], groupId: 'OuterGroup000001' }).ok).toBe(true);
  const copied = duplicate(t);
  expect(t.get(copied.screen)).not.toHaveProperty('name');
  expect(t.get(copied.ids[t.left] as string)['semantic']).toEqual(metadata);
  expect(t.get(copied.ids[t.right] as string)).not.toHaveProperty('semantic');
  expect(t.get(t.left)['semantic']).toEqual({ slug: 'left', ...metadata });
  expect(t.get(t.right)['semantic']).toEqual({ slug: 'right' });
  for (const id of [t.left, t.right, t.internal, 'InnerGroup000001']) {
    const original = t.get(id);
    const copy = t.get(copied.ids[id] as string);
    expect(copy['parentId']).toBe(copied.ids[String(original['parentId'])]);
    expect(copy['screenId']).toBe(copied.screen);
    expect(copy['transform']).toEqual(original['transform']);
  }
  expect(t.get(copied.ids['OuterGroup000001'] as string)).not.toHaveProperty('parentId');
  const after = t.store.toDocument();
  t.store.history.undo();
  expect(t.store.toDocument()).toEqual(copied.before);
  t.store.history.redo();
  expect(t.store.toDocument()).toEqual(after);
});

it('FR-SCR-002: copy selection excludes bindings crossing either screen boundary', () => {
  const t = setup(true);
  const elements = t.store.members('byScreen', t.screen);
  const bindings = t.store.members('byType', 'binding');
  const expected = bindings.filter((id) => {
    const r = t.get(id);
    return r['connectorId'] === t.internal || (r['connectorId'] === t.outgoing && r['elementId'] === t.left);
  });
  const external = bindings.filter((id) => !expected.includes(id));
  expect(expected).toHaveLength(3);
  expect(external).toHaveLength(3);
  const selected = screenRecordsToCopy(t.store, t.screen);
  expect(selected.slice(0, elements.length)).toEqual(elements);
  expect(selected.slice(elements.length).sort()).toEqual([...expected].sort());
  for (const id of external) expect(selected).not.toContain(id);
});

it('FR-SCR-002: duplicate preserves complete internal binding records and exact undo', () => {
  const t = setup();
  const bindings = t.store.members('byType', 'binding');
  const expected = [...bindings];
  const copied = duplicate(t);
  for (const id of expected) {
    const r = t.get(id);
    expect(t.get(copied.ids[id] as string)).toEqual({
      ...r,
      id: copied.ids[id],
      connectorId: copied.ids[String(r['connectorId'])],
      elementId: copied.ids[String(r['elementId'])],
    });
  }
  expect(t.store.members('byType', 'binding')).toHaveLength(bindings.length + expected.length);
  const after = t.store.toDocument();
  t.store.history.undo();
  expect(t.store.toDocument()).toEqual(copied.before);
  t.store.history.redo();
  expect(t.store.toDocument()).toEqual(after);
});
