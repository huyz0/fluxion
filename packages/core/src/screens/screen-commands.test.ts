import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { registerCoreCommands } from '../builtin-commands.js';
import { type AnyCommand, executeCommand } from '../commands.js';
import { type IntegrityHook, registerCoreHooks } from '../hooks.js';
import { createRegistry } from '../registry.js';
import { RecordStore } from '../store.js';
import { nextVisibleScreen } from './screen-order.js';

type Rec = Record<string, unknown>;

const NOTES = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Say hello' }] }] };

/** Three screens; the first holds two shapes joined by a connector (a binding at each end) and a slugged shape. */
function setup() {
  const b = documentBuilder({ seed: 211 });
  const first = b.screen({ name: 'one' });
  const second = b.screen({ name: 'two' });
  const third = b.screen({ name: 'three' });
  const left = b.rect(first, { x: 0, y: 0 });
  const right = b.rect(first, { x: 300, y: 0 });
  const link = b.connect(left, right);
  const other = b.rect(second, { x: 0, y: 0 });
  const hooks = createRegistry<string, IntegrityHook>('integrityHooks');
  registerCoreHooks(hooks);
  const store = new RecordStore(b.build(), { hooks });
  const commands = createRegistry<string, AnyCommand>('commands');
  registerCoreCommands(commands);
  const run = (id: string, args: unknown) => executeCommand(commands, { store }, id, args);
  const get = (id: string) => store.get(id as RecordId) as unknown as Rec;
  const idsOn = (screen: string) => store.members('byScreen', screen as RecordId);
  const bindings = () => store.members('byType', 'binding');
  return { store, run, get, idsOn, bindings, first, second, third, left, right, link, other };
}

/** A new id for each of `old`, by old id. */
const fresh = (old: readonly string[], tag: string) => Object.fromEntries(old.map((o, i) => [o, `${tag}${String(i).padStart(6, '0')}Copy`]));

describe('screen commands (FR-SCR-002)', () => {
  it('FR-SCR-002: every screen command is one undo step', () => {
    const t = setup();
    const copies = fresh([...t.idsOn(t.first), ...t.bindings()], 'Dup');
    const steps: ReadonlyArray<readonly [string, unknown]> = [
      ['screen.create', { screen: { id: 'NewScreenAAAA0001', type: 'screen', index: 'a0' } }],
      ['screen.rename', { id: t.second, name: 'renamed' }],
      ['screen.setNotes', { id: t.second, notes: NOTES }],
      ['screen.setFormat', { id: t.second, format: { kind: 'fixed', size: { w: 1600, h: 1200 } } }],
      ['screen.setHidden', { id: t.second, hidden: true }],
      ['screen.reorder', { id: t.third, after: t.first }],
      ['screen.duplicate', { id: t.first, newId: 'DupScreenAAAA0001', ids: copies }],
      ['screen.delete', { id: t.second }],
    ];
    for (const [command, args] of steps) {
      const before = JSON.parse(JSON.stringify(t.store.toDocument())) as unknown;
      const depth = t.store.history.undoDepth;
      expect(t.run(command, args).ok, command).toBe(true);
      expect(t.store.history.undoDepth, command).toBe(depth + 1);
      expect(t.store.toDocument()).not.toEqual(before);
      t.store.history.undo();
      expect(t.store.toDocument(), command).toEqual(before);
      t.store.history.redo();
    }
  });

  it('FR-SCR-002: reordering a screen changes exactly one record', () => {
    const t = setup();
    const before = new Map(t.store.ids().map((i) => [i, JSON.stringify(t.get(i))]));
    expect(t.run('screen.reorder', { id: t.third, after: t.first }).ok).toBe(true);
    const changed = t.store.ids().filter((i) => before.get(i) !== JSON.stringify(t.get(i)));
    expect(changed).toEqual([t.third]);
  });

  it('FR-SCR-002: a duplicated screen has new ids and its internal bindings remapped', () => {
    const t = setup();
    const old = [...t.idsOn(t.first), ...t.bindings()];
    const ids = fresh(old, 'Dup');
    const slugged = t.left;
    expect(t.run('element.update', { id: slugged, fields: { semantic: { slug: 'left-one' } } }).ok).toBe(true);
    expect(t.run('screen.duplicate', { id: t.first, newId: 'DupScreenAAAA0001', ids }).ok).toBe(true);
    // just after the original, named as a copy; the original untouched
    const order = t.store.members('byType', 'screen').sort((x, y) => (String(t.get(x)['index']) < String(t.get(y)['index']) ? -1 : 1));
    expect(order).toEqual([t.first, 'DupScreenAAAA0001', t.second, t.third]);
    expect(t.get('DupScreenAAAA0001')['name']).toBe('one copy');
    // every element copied under a new id on the new screen, none shared with the original
    const copied = t.idsOn('DupScreenAAAA0001');
    expect([...copied].sort()).toEqual(
      t
        .idsOn(t.first)
        .map((e) => ids[e])
        .sort(),
    );
    expect(t.idsOn(t.first).every((e) => !copied.includes(e))).toBe(true);
    expect(t.get(ids[t.link] as string)['screenId']).toBe('DupScreenAAAA0001');
    // the copied connector's bindings point at the copied shapes, the originals' still at the originals
    const ends = (c: string) =>
      t
        .bindings()
        .map((b) => t.get(b))
        .filter((b) => b['connectorId'] === c)
        .map((b) => [b['end'], b['elementId']])
        .sort();
    expect(ends(ids[t.link] as string)).toEqual([
      ['source', ids[t.left]],
      ['target', ids[t.right]],
    ]);
    expect(ends(t.link)).toEqual([
      ['source', t.left],
      ['target', t.right],
    ]);
    // a slug names one element only: the copy has none
    expect(JSON.stringify(t.get(ids[slugged] as string))).not.toContain('left-one');
    expect(JSON.stringify(t.get(slugged))).toContain('left-one');
  });

  it('FR-SCR-002: a duplicate that lacks a new id, reuses one or takes a used one is refused and changes nothing', () => {
    const t = setup();
    const old = [...t.idsOn(t.first), ...t.bindings()];
    const ids = fresh(old, 'Dup');
    const before = JSON.stringify(t.store.toDocument());
    const dropped = old[0] as string;
    const kept = old.slice(1);
    const without = Object.fromEntries(kept.map((k) => [k, ids[k] as string]));
    expect(t.run('screen.duplicate', { id: t.first, newId: 'DupScreenAAAA0001', ids: without }).ok).toBe(false);
    const twice = { ...ids, [dropped]: ids[kept[0] as string] as string };
    expect(t.run('screen.duplicate', { id: t.first, newId: 'DupScreenAAAA0001', ids: twice }).ok).toBe(false);
    const used = { ...ids, [dropped]: t.other };
    expect(t.run('screen.duplicate', { id: t.first, newId: 'DupScreenAAAA0001', ids: used }).ok).toBe(false);
    expect(t.run('screen.duplicate', { id: t.first, newId: t.second, ids }).ok).toBe(false);
    expect(t.run('screen.duplicate', { id: t.left, newId: 'DupScreenAAAA0001', ids }).ok).toBe(false);
    expect(JSON.stringify(t.store.toDocument())).toBe(before);
  });

  it('FR-SCR-002: a hidden screen is marked and skipped by the next visible screen lookup', () => {
    const t = setup();
    expect(nextVisibleScreen(t.store, t.first)).toBe(t.second);
    expect(t.run('screen.setHidden', { id: t.second, hidden: true }).ok).toBe(true);
    expect(t.get(t.second)['hidden']).toBe(true);
    expect(nextVisibleScreen(t.store, t.first)).toBe(t.third);
    expect(nextVisibleScreen(t.store, t.third, -1)).toBe(t.first);
    // from a hidden screen itself, and at either end
    expect(nextVisibleScreen(t.store, t.second)).toBe(t.third);
    expect(nextVisibleScreen(t.store, t.third)).toBeUndefined();
    expect(nextVisibleScreen(t.store, t.first, -1)).toBeUndefined();
    expect(nextVisibleScreen(t.store, 'Missing' as RecordId)).toBeUndefined();
    // showing it again removes the mark rather than writing false
    expect(t.run('screen.setHidden', { id: t.second, hidden: false }).ok).toBe(true);
    expect('hidden' in t.get(t.second)).toBe(false);
    expect(nextVisibleScreen(t.store, t.first)).toBe(t.second);
  });

  it('FR-SCR-002: renaming sets the name; a non-screen id is refused', () => {
    const t = setup();
    expect(t.run('screen.rename', { id: t.first, name: 'Intro' }).ok).toBe(true);
    expect(t.get(t.first)['name']).toBe('Intro');
    expect(t.run('screen.rename', { id: t.left, name: 'x' }).ok).toBe(false);
    expect(t.run('screen.setHidden', { id: t.left, hidden: true }).ok).toBe(false);
  });

  it('FR-SCR-003: a screen takes a fixed size or an infinite viewport, and loses the fields of the format it leaves', () => {
    const t = setup();
    expect(t.run('screen.setFormat', { id: t.first, format: { kind: 'fixed', size: { w: 1080, h: 1920 } } }).ok).toBe(true);
    expect([t.get(t.first)['size'], 'kind' in t.get(t.first)]).toEqual([{ w: 1080, h: 1920 }, false]);
    const view = { x: -100, y: -50, w: 800, h: 600 };
    expect(t.run('screen.setFormat', { id: t.first, format: { kind: 'infinite', viewport: view } }).ok).toBe(true);
    expect([t.get(t.first)['kind'], t.get(t.first)['viewport'], 'size' in t.get(t.first)]).toEqual(['infinite', view, false]);
    expect(t.run('screen.setFormat', { id: t.first, format: { kind: 'fixed', size: { w: 1920, h: 1080 } } }).ok).toBe(true);
    expect(['viewport' in t.get(t.first), 'kind' in t.get(t.first)]).toEqual([false, false]);
    // elements stay where they are
    expect((t.get(t.right)['transform'] as { x: number }).x).toBe(300);
    // a size must be positive, and only a screen has a format
    expect(t.run('screen.setFormat', { id: t.first, format: { kind: 'fixed', size: { w: 0, h: 10 } } }).ok).toBe(false);
    expect(t.run('screen.setFormat', { id: t.left, format: { kind: 'fixed', size: { w: 10, h: 10 } } }).ok).toBe(false);
  });

  it('FR-SCR-006: speaker notes are set on a screen and removed again, and only a screen has them', () => {
    const t = setup();
    expect(t.run('screen.setNotes', { id: t.first, notes: NOTES }).ok).toBe(true);
    expect(t.get(t.first)['notes']).toEqual(NOTES);
    expect(t.run('screen.setNotes', { id: t.first }).ok).toBe(true);
    expect('notes' in t.get(t.first)).toBe(false);
    t.store.history.undo();
    expect(t.get(t.first)['notes']).toEqual(NOTES);
    expect(t.run('screen.setNotes', { id: t.left, notes: NOTES }).ok).toBe(false);
    // something that is not a rich-text document is refused whole
    expect(t.run('screen.setNotes', { id: t.first, notes: { type: 'paragraph', content: [] } }).ok).toBe(false);
    expect(t.run('screen.setNotes', { id: t.first, notes: 'text' }).ok).toBe(false);
    expect(t.get(t.first)['notes']).toEqual(NOTES);
  });
});
