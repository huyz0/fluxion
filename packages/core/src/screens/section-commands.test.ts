import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { registerCoreCommands } from '../builtin-commands.js';
import { type AnyCommand, executeCommand } from '../commands.js';
import { type IntegrityHook, registerCoreHooks } from '../hooks.js';
import { createRegistry } from '../registry.js';
import { RecordStore } from '../store.js';

type Rec = Record<string, unknown>;

/** Two screens and a shape, and a store over them with the core commands. */
function setup() {
  const b = documentBuilder({ seed: 311 });
  const one = b.screen({ name: 'one' });
  const two = b.screen({ name: 'two' });
  const three = b.screen({ name: 'three' });
  const shape = b.rect(one);
  const hooks = createRegistry<string, IntegrityHook>('integrityHooks');
  registerCoreHooks(hooks);
  const store = new RecordStore(b.build(), { hooks });
  const commands = createRegistry<string, AnyCommand>('commands');
  registerCoreCommands(commands);
  const run = (id: string, args: unknown) => executeCommand(commands, { store }, id, args);
  const get = (id: string) => store.get(id as RecordId) as unknown as Rec;
  const sections = () =>
    store
      .members('byType', 'section')
      .sort((x, y) => (String(get(x)['index']) < String(get(y)['index']) ? -1 : 1))
      .map((x) => get(x)['name']);
  return { store, run, get, sections, one, two, three, shape };
}

describe('section commands (FR-SCR-004)', () => {
  it('FR-SCR-004: sections are created in order, renamed, folded and moved, each one undo step', () => {
    const t = setup();
    expect(t.run('section.create', { id: 'SecA00000000001', name: 'Intro' }).ok).toBe(true);
    expect(t.run('section.create', { id: 'SecB00000000001', name: 'Body', after: 'SecA00000000001' }).ok).toBe(true);
    expect(t.run('section.create', { id: 'SecC00000000001', name: 'End', after: 'SecB00000000001' }).ok).toBe(true);
    expect(t.sections()).toEqual(['Intro', 'Body', 'End']);
    // a section with no `after` is first
    expect(t.run('section.create', { id: 'SecD00000000001', name: 'Cover' }).ok).toBe(true);
    expect(t.sections()).toEqual(['Cover', 'Intro', 'Body', 'End']);
    const depth = t.store.history.undoDepth;
    expect(t.run('section.rename', { id: 'SecA00000000001', name: 'Start' }).ok).toBe(true);
    expect(t.run('section.setCollapsed', { id: 'SecA00000000001', collapsed: true }).ok).toBe(true);
    expect(t.get('SecA00000000001')['collapsed']).toBe(true);
    expect(t.run('section.setCollapsed', { id: 'SecA00000000001', collapsed: false }).ok).toBe(true);
    expect('collapsed' in t.get('SecA00000000001')).toBe(false);
    expect(t.store.history.undoDepth).toBe(depth + 3);
    // moving a section changes exactly that record
    const before = new Map(t.store.ids().map((i) => [i, JSON.stringify(t.get(i))]));
    expect(t.run('section.reorder', { id: 'SecD00000000001', after: 'SecC00000000001' }).ok).toBe(true);
    expect(t.store.ids().filter((i) => before.get(i) !== JSON.stringify(t.get(i)))).toEqual(['SecD00000000001']);
    expect(t.sections()).toEqual(['Start', 'Body', 'End', 'Cover']);
    t.store.history.undo();
    expect(t.sections()).toEqual(['Cover', 'Start', 'Body', 'End']);
  });

  it('FR-SCR-004: a screen moves between sections and out of them, one undo step each', () => {
    const t = setup();
    t.run('section.create', { id: 'SecA00000000001', name: 'A' });
    t.run('section.create', { id: 'SecB00000000001', name: 'B', after: 'SecA00000000001' });
    const depth = t.store.history.undoDepth;
    expect(t.run('screen.setSection', { id: t.two, sectionId: 'SecA00000000001' }).ok).toBe(true);
    expect(t.run('screen.setSection', { id: t.two, sectionId: 'SecB00000000001' }).ok).toBe(true);
    expect(t.get(t.two)['sectionId']).toBe('SecB00000000001');
    expect(t.run('screen.setSection', { id: t.two }).ok).toBe(true);
    expect('sectionId' in t.get(t.two)).toBe(false);
    expect(t.store.history.undoDepth).toBe(depth + 3);
    t.store.history.undo();
    expect(t.get(t.two)['sectionId']).toBe('SecB00000000001');
    // only a screen can be moved, only into a section that exists
    expect(t.run('screen.setSection', { id: t.shape, sectionId: 'SecA00000000001' }).ok).toBe(false);
    expect(t.run('screen.setSection', { id: t.one, sectionId: 'Nope' }).ok).toBe(false);
    expect(t.run('screen.setSection', { id: t.one, sectionId: t.three }).ok).toBe(false);
  });

  it('FR-SCR-004: deleting a section lets its screens go, in one undo step', () => {
    const t = setup();
    t.run('section.create', { id: 'SecA00000000001', name: 'A' });
    t.run('screen.setSection', { id: t.one, sectionId: 'SecA00000000001' });
    t.run('screen.setSection', { id: t.two, sectionId: 'SecA00000000001' });
    const before = JSON.parse(JSON.stringify(t.store.toDocument()));
    const depth = t.store.history.undoDepth;
    expect(t.run('section.delete', { id: 'SecA00000000001' }).ok).toBe(true);
    expect(t.store.history.undoDepth).toBe(depth + 1);
    expect(t.store.has('SecA00000000001' as RecordId)).toBe(false);
    expect(['sectionId' in t.get(t.one), 'sectionId' in t.get(t.two)]).toEqual([false, false]);
    t.store.history.undo();
    expect(t.store.toDocument()).toEqual(before);
    // an id that is not a section is refused, and so is one used twice
    expect(t.run('section.delete', { id: t.one }).ok).toBe(false);
    expect(t.run('section.create', { id: 'SecA00000000001', name: 'again' }).ok).toBe(false);
    expect(t.run('section.reorder', { id: 'SecA00000000001', after: 'SecA00000000001' }).ok).toBe(false);
  });

  it('FR-SCR-004: moving a screen changes its place and section in one undo step', () => {
    const t = setup();
    t.run('section.create', { id: 'SecA00000000001', name: 'A' });
    const before = JSON.parse(JSON.stringify(t.store.toDocument()));
    const depth = t.store.history.undoDepth;
    expect(t.run('screen.move', { id: t.three, after: t.one, sectionId: 'SecA00000000001' }).ok).toBe(true);
    expect(t.store.history.undoDepth).toBe(depth + 1);
    expect(t.get(t.three)['sectionId']).toBe('SecA00000000001');
    expect(t.run('screen.reorder', { id: t.three, after: t.one }).ok).toBe(true);
    // out of the section: the move without one clears it, and a record other than a screen or section is refused
    expect(t.run('screen.move', { id: t.three, after: t.two }).ok).toBe(true);
    expect('sectionId' in t.get(t.three)).toBe(false);
    expect(t.run('screen.move', { id: t.shape, sectionId: 'SecA00000000001' }).ok).toBe(false);
    expect(t.run('screen.move', { id: t.three, sectionId: t.one }).ok).toBe(false);
    while (t.store.history.undoDepth > depth) t.store.history.undo();
    expect(t.store.toDocument()).toEqual(before);
  });
});
