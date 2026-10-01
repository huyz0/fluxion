import { createCore, type ShapeDef } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { registerBuiltinTools } from './builtin-tools.js';
import { paramEdit, paramHandleAt, paramHandlesOf } from './param-handles.js';
import type { PointerInfo, PointerPhase } from './pointer.js';
import { createSession } from './session.js';
import { createToolDispatcher, createToolRegistry } from './tools.js';

const rounded: ShapeDef = {
  id: 'test:rounded',
  params: { r: { type: 'number', min: 0, max: 1000, default: 12 }, extra: { type: 'number', default: 1 } },
  outline: { path: 'M 0 0 L {w} 0 L {w} {h} Z' },
  handles: [{ param: 'r', x: 'min(r, w/2, h/2)', y: '0' }],
  defaultSize: { w: 100, h: 100 },
};
const plain: ShapeDef = { id: 'test:plain', outline: { path: 'M 0 0 L {w} 0 L {w} {h} Z' }, defaultSize: { w: 100, h: 100 } };
const defs = { get: (id: string) => ({ 'test:rounded': rounded, 'test:plain': plain })[id as 'test:plain'] };

function setup(transform: object = {}, params?: object) {
  const b = documentBuilder({ seed: 17 });
  const s = b.screen();
  const shape = b.rect(s, { x: 100, y: 50, w: 160, h: 100, defId: 'test:rounded' });
  const flat = b.rect(s, { x: 0, y: 0, w: 10, h: 10, defId: 'test:plain' });
  const text = b.text(s, 'x');
  const doc = b.build();
  const rec = doc.records[shape] as unknown as { transform: object };
  const core = createCore({
    ...doc,
    records: { ...doc.records, [shape]: { ...rec, transform: { ...rec.transform, ...transform }, ...(params ? { params } : {}) } },
  } as typeof doc);
  return { core, shape, flat, text, s };
}

const at = (phase: PointerPhase, x: number, y: number, o: Partial<PointerInfo> = {}): PointerInfo => ({
  phase,
  pointerId: 1,
  pointerType: 'mouse',
  screen: { x, y },
  page: { x, y },
  button: 0,
  buttons: phase === 'up' ? 0 : 1,
  shift: false,
  alt: false,
  mod: false,
  pressure: 0.5,
  coalesced: [],
  ...o,
});

describe('parametric handles in the editor (FR-SHP-003)', () => {
  it('FR-SHP-003: a shape`s handles are on the page where its box puts them, turned and flipped with it', () => {
    const { core, shape, flat, text, s } = setup();
    expect(paramHandlesOf(core.store, defs, shape)).toEqual([{ element: shape, index: 0, param: 'r', page: { x: 112, y: 50 } }]);
    // a quarter turn about the centre (180, 100): the top edge`s point goes to the right edge
    const turned = setup({ rot: 90 });
    const [h] = paramHandlesOf(turned.core.store, defs, turned.shape);
    expect(h?.page.x).toBeCloseTo(230, 6);
    expect(h?.page.y).toBeCloseTo(32, 6);
    const flipped = setup({ flipX: true });
    expect(paramHandlesOf(flipped.core.store, defs, flipped.shape)[0]?.page).toEqual({ x: 248, y: 50 });
    // nothing for a shape without handles, a text element, a screen, a missing record
    for (const id of [flat, text, s, 'gone' as RecordId]) expect(paramHandlesOf(core.store, defs, id)).toEqual([]);
    // nothing for a definition that is not registered, or has an empty list
    expect(paramHandlesOf(core.store, { get: () => undefined }, shape)).toEqual([]);
    expect(paramHandlesOf(core.store, { get: () => ({ ...rounded, handles: [] }) }, shape)).toEqual([]);
  });

  it('FR-SHP-003: the handle under a point is the nearest within reach', () => {
    const near = { element: 'a' as RecordId, index: 0, param: 'p', page: { x: 10, y: 10 } };
    const nearer = { element: 'a' as RecordId, index: 1, param: 'q', page: { x: 12, y: 10 } };
    expect(paramHandleAt([near, nearer], { x: 13, y: 10 }, 5)).toBe(nearer);
    expect(paramHandleAt([near, nearer], { x: 9, y: 10 }, 5)).toBe(near);
    expect(paramHandleAt([near, nearer], { x: 20, y: 10 }, 5)).toBeUndefined();
    // exactly at reach is on it
    expect(paramHandleAt([near], { x: 15, y: 10 }, 5)).toBe(near);
    expect(paramHandleAt([], { x: 0, y: 0 }, 5)).toBeUndefined();
  });

  it('FR-SHP-003: dragging a handle sets its param to the value that puts it under the pointer, the other params kept', () => {
    const { core, shape } = setup({}, { extra: 3 });
    const edit = paramEdit(core.store, defs, { id: shape, index: 0 }, { x: 140, y: 80 });
    expect(edit?.id).toBe('element.update');
    expect(core.execute(edit?.id as string, edit?.args).ok).toBe(true);
    const params = (core.store.get(shape) as unknown as { params: { r: number; extra: number } }).params;
    expect(params.r).toBeCloseTo(40, 2);
    expect(params.extra).toBe(3);
    // through a quarter turn: the pointer`s page point is mapped back into the box
    const turned = setup({ rot: 90 });
    const e = paramEdit(turned.core.store, defs, { id: turned.shape, index: 0 }, { x: 230, y: 60 });
    turned.core.execute(e?.id as string, e?.args);
    expect((turned.core.store.get(turned.shape) as unknown as { params: { r: number } }).params.r).toBeCloseTo(40, 1);
    // no handle, no shape, no definition: no command
    expect(paramEdit(core.store, defs, { id: shape, index: 3 }, { x: 0, y: 0 })).toBeUndefined();
    expect(paramEdit(core.store, defs, { id: 'gone' as RecordId, index: 0 }, { x: 0, y: 0 })).toBeUndefined();
  });

  it('FR-SHP-003: the select tool drags a handle as one undo step, and Esc puts the params back', () => {
    const { core, shape, session } = (() => {
      const o = setup();
      return { ...o, session: createSession('doc') };
    })();
    const registry = createToolRegistry();
    registerBuiltinTools(registry);
    const tools = createToolDispatcher(registry, {
      session,
      view: core.store,
      execute: core.execute,
      seal: () => core.store.history.seal(),
      newId: () => 'newnewnewnew0001' as RecordId,
      hitTest: () => undefined,
      elementsIn: () => [],
      screen: undefined,
      allElements: () => [],
      shapeDefs: defs,
    });
    const r = () => (core.store.get(shape) as unknown as { params?: { r: number } }).params?.r;
    session.selection.set([shape]);
    // the handle is at (112, 50): a press there starts adjusting instead of selecting
    expect(tools.pointer(at('down', 112, 50))).toBe(true);
    expect(tools.current).toBe('select.adjusting');
    tools.pointer(at('move', 130, 60));
    tools.pointer(at('move', 150, 60));
    expect(r()).toBeCloseTo(50, 1);
    tools.pointer(at('up', 150, 60));
    expect(tools.current).toBe('select.idle');
    // the whole drag is one undo step
    core.store.history.undo();
    expect(r()).toBeUndefined();
    expect(core.store.history.canUndo()).toBe(false);
    // Esc mid-drag restores
    expect(tools.pointer(at('down', 112, 50))).toBe(true);
    tools.pointer(at('move', 150, 60));
    expect(r()).toBeCloseTo(50, 1);
    tools.escape();
    expect(r()).toBeUndefined();
    expect(tools.current).toBe('select.idle');
    // a press elsewhere is not a handle; neither is one with two shapes selected
    session.selection.set([shape, 'other' as RecordId]);
    tools.pointer(at('down', 112, 50));
    expect(tools.current).not.toBe('select.adjusting');
  });
});
