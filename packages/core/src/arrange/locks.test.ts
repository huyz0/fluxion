// FR-SHP-008: core's arranging commands respect editing locks (M19.15, M19 cp2 F3). A position lock keeps an element where it is
// through align and distribute (its box still counts); match size skips a size lock and keeps the ratio under an aspect lock, a
// group's members scaling with it; the format painter skips an edit lock, a group's included.
import type { AnyRecord, DocumentFile, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { createCore } from '../bootstrap.js';
import { hasLock, lockedWithin } from './locks.js';

type Box = { x: number; y: number; w: number; h: number; rot: number };

/** Rects a, b, c in a row (a locked in place), a key k, a group G holding p, and the core. */
function setup(locks: Record<string, Record<string, boolean>> = {}) {
  const b = documentBuilder({ seed: 1915 });
  const screen = b.screen();
  const doc = b.build();
  const add = (id: string, index: string, kind: string, fields: Record<string, unknown>) => {
    const lock = locks[id] === undefined ? {} : { locks: locks[id] };
    (doc.records as Record<string, AnyRecord>)[id] = { id, type: 'element', kind, screenId: screen, index, ...lock, ...fields } as unknown as AnyRecord;
    return id as RecordId;
  };
  const box = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h, rot: 0 });
  const rect = (id: string, index: string, t: Box, extra: Record<string, unknown> = {}) =>
    add(id, index, 'shape', { defId: 'basic:rect', transform: t, style: { fill: '#111111' }, ...extra });
  const a = rect('a', 'a0', box(0, 0, 50, 40));
  const bb = rect('b', 'a1', box(100, 20, 50, 40));
  const c = rect('c', 'a2', box(300, 50, 50, 40));
  const k = rect('k', 'a3', box(0, 200, 200, 100), { style: { fill: '#ff0000' } });
  const g = add('G', 'a4', 'group', { transform: box(0, 400, 100, 50) });
  const p = rect('p', 'a0', box(0, 400, 100, 50), { parentId: g });
  const core = createCore(doc as DocumentFile);
  const t = (id: RecordId) => (core.store.get(id) as unknown as { transform: Box }).transform;
  const fill = (id: RecordId) => (core.store.get(id) as unknown as { style?: { fill?: string } }).style?.fill;
  return { core, a, b: bb, c, k, g, p, t, fill };
}

describe('locks in core commands (FR-SHP-008)', () => {
  it('FR-SHP-008: align leaves a position-locked element where it is, aligning the others to bounds it still counts in', () => {
    const { core, a, b, c, t } = setup({ a: { position: true } });
    expect(core.execute('element.align', { ids: [a, b, c], mode: 'bottom', to: 'selection' }).ok).toBe(true);
    // the bottom of the three is c's (90): a stays, b moves down to it
    expect(t(a).y).toBe(0);
    expect(t(b).y).toBe(50);
    expect(t(c).y).toBe(50);
  });

  it('FR-SHP-008: distribute leaves a position-locked element in place and spaces the others among themselves', () => {
    const locked = setup({ b: { position: true } });
    // three are needed besides the locked one
    expect(locked.core.execute('element.distribute', { ids: [locked.a, locked.b, locked.c], axis: 'horizontal', by: 'gaps' }).ok).toBe(false);
    expect(locked.core.execute('element.distribute', { ids: [locked.a, locked.b, locked.c, locked.k], axis: 'vertical', by: 'gaps' }).ok).toBe(true);
    expect(locked.t(locked.b).y).toBe(20);
    // a (0..40), c (50..90), k (200..300): even gaps of 60 put c at 100
    expect(locked.t(locked.c).y).toBe(100);
    const free = setup();
    expect(free.core.execute('element.distribute', { ids: [free.a, free.b, free.c], axis: 'horizontal', by: 'gaps' }).ok).toBe(true);
    expect(free.t(free.b).x).toBe(150);
  });

  it('FR-SHP-008: match size skips a size-locked element and keeps the ratio of an aspect-locked one, a group included', () => {
    const { core, a, b, c, k, g, p, t } = setup({ a: { size: true }, b: { aspect: true }, G: { aspect: true } });
    expect(core.execute('element.matchSize', { ids: [a, b, c, g], key: k, mode: 'width' }).ok).toBe(true);
    expect(t(a)).toMatchObject({ w: 50, h: 40 });
    // 50x40 to a width of 200 keeps 5:4
    expect(t(b)).toMatchObject({ w: 200, h: 160 });
    expect(t(c)).toMatchObject({ w: 200, h: 40 });
    // the group's member scales with the group's kept ratio (100x50 → 200x100)
    expect(t(p)).toMatchObject({ x: 0, y: 400, w: 200, h: 100 });
    expect(core.execute('element.matchSize', { ids: [b], key: k, mode: 'height' }).ok).toBe(true);
    expect(t(b)).toMatchObject({ w: 125, h: 100 });
  });

  it('FR-SHP-008: the format painter skips an edit-locked element and the members of an edit-locked group', () => {
    const locked = setup({ a: { edit: true }, G: { edit: true } });
    expect(locked.core.execute('element.pasteStyle', { from: locked.k, ids: [locked.a, locked.b, locked.g] }).ok).toBe(true);
    expect([locked.fill(locked.a), locked.fill(locked.b), locked.fill(locked.p)]).toEqual(['#111111', '#ff0000', '#111111']);
    // an edit-locked group nested in an unlocked one keeps its members' style too
    const nested = setup({ p: { edit: true } });
    expect(nested.core.execute('element.group', { ids: [nested.g, nested.c], groupId: 'outer' }).ok).toBe(true);
    expect(nested.core.execute('element.update', { id: nested.g, fields: { locks: { edit: true } } }).ok).toBe(true);
    expect(nested.core.execute('element.update', { id: nested.p, fields: { locks: undefined } }).ok).toBe(true);
    expect(nested.core.execute('element.pasteStyle', { from: nested.k, ids: ['outer'] }).ok).toBe(true);
    expect([nested.fill(nested.p), nested.fill(nested.c)]).toEqual(['#111111', '#ff0000']);
    const member = setup({ p: { edit: true } });
    expect(member.core.execute('element.pasteStyle', { from: member.k, ids: [member.g, member.c] }).ok).toBe(true);
    expect([member.fill(member.p), member.fill(member.c)]).toEqual(['#111111', '#ff0000']);
  });

  it('FR-SHP-008: hasLock reads one element; lockedWithin also reads the groups it sits in', () => {
    const { core, g, p, a } = setup({ G: { select: true } });
    expect(hasLock(core.store, g, 'select')).toBe(true);
    expect(hasLock(core.store, p, 'select')).toBe(false);
    expect(lockedWithin(core.store, p, 'select')).toBe(true);
    expect(lockedWithin(core.store, a, 'select')).toBe(false);
  });
});
