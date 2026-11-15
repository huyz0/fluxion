import { CORE_PATH_ID, createCore } from '@fluxion/core';
import type { Vec2 } from '@fluxion/geometry';
import type { PathData, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { registerBuiltinTools } from './builtin-tools.js';
import { pathEdit, pathHandleAt, pathSegmentAt, pathTarget, placedPathHandles, toPathBox } from './path-edit.js';
import { moveHandle } from './path-edit-model.js';
import { editSelectedPath, enterPathEdit, leavePathEdit, removeSelectedPoint } from './path-edit-states.js';
import type { PointerInfo, PointerPhase } from './pointer.js';
import { createSession } from './session.js';
import { createToolDispatcher, createToolRegistry, type ToolCtx } from './tools.js';

/** A triangle path shape (reference box 100 × 50, drawn at 200 × 100 from (100, 100)) and a rect, with `transform` changes. */
function setup(transform: object = {}) {
  const b = documentBuilder({ seed: 1919 });
  const s = b.screen({ size: { w: 1000, h: 1000 } });
  const shape = b.rect(s, { x: 100, y: 100, w: 200, h: 100 });
  const rect = b.rect(s, { x: 600, y: 600, w: 50, h: 50 });
  const doc = b.build();
  const rec = doc.records[shape] as unknown as { transform: object };
  const path: PathData = { d: 'M 0 0 L 100 0 L 50 50 Z', w: 100, h: 50 };
  const core = createCore({
    ...doc,
    records: { ...doc.records, [shape]: { ...rec, defId: CORE_PATH_ID, path, transform: { ...rec.transform, ...transform } } },
  } as typeof doc);
  return { core, shape, rect };
}

const path = (core: ReturnType<typeof setup>['core'], id: RecordId) =>
  core.store.get(id) as unknown as { path: PathData; transform: { x: number; y: number; w: number; h: number; rot?: number } };

const at = (phase: PointerPhase, x: number, y: number): PointerInfo => ({
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
});

/** The select tool over `setup()`'s document, its hit-test answering the path shape inside its box. */
function tooling(t: ReturnType<typeof setup>) {
  const session = createSession('doc');
  const registry = createToolRegistry();
  registerBuiltinTools(registry);
  const ctx: ToolCtx = {
    session,
    view: t.core.store,
    execute: t.core.execute,
    seal: () => t.core.store.history.seal(),
    newId: () => 'newnewnewnew0001' as RecordId,
    hitTest: (p) => (p.x >= 100 && p.x <= 300 && p.y >= 100 && p.y <= 200 ? t.shape : p.x >= 600 ? t.rect : undefined),
    elementsIn: () => [],
    screen: undefined,
    allElements: () => [],
  };
  return { session, ctx, tools: createToolDispatcher(registry, ctx) };
}

describe('the path tool on the page (FR-SHP-011, ADR-0053)', () => {
  it('FR-SHP-011: vertices and bezier handles are placed through the scale and turn; presses find them and segments', () => {
    const t = setup({ rot: 90 });
    const target = pathTarget(t.core.store, t.shape);
    if (target === undefined) throw new Error('no target');
    // turned a quarter about (200, 150): the reference (0, 0) is the box's top-left, now at (250, 50)
    const handles = placedPathHandles(target);
    expect(handles.map((h) => [Math.round(h.page.x), Math.round(h.page.y)])).toEqual([
      [250, 50],
      [250, 250],
      [150, 150],
    ]);
    expect(pathHandleAt(handles, { x: 248, y: 245 }, 8)?.handle).toEqual({ kind: 'vertex', sub: 0, index: 1 });
    expect(pathHandleAt(handles, { x: 0, y: 0 }, 8)).toBeUndefined();
    // the first edge, from (250, 50) to (250, 250), a quarter of the way along
    const on = pathSegmentAt(target, { x: 251, y: 100 }, 4);
    expect(on?.sub).toBe(0);
    expect(on?.index).toBe(0);
    expect(on?.t).toBeCloseTo(0.25, 3);
    expect(pathSegmentAt(target, { x: 200, y: 150 }, 4)).toBeUndefined();
    expect(pathTarget(t.core.store, t.rect)).toBeUndefined();
  });

  it('FR-SHP-011: an edit refits d, w, h and the box so the points that did not move stay put on the page, turned and flipped', () => {
    const t = setup({ rot: 30, flipX: true });
    const target = pathTarget(t.core.store, t.shape);
    if (target === undefined) throw new Error('no target');
    const before = placedPathHandles(target).map((h) => h.page) as Vec2[];
    const top = before[2] as Vec2;
    // the apex dragged well below the box: the bounds grow
    const apex = toPathBox(target, { x: top.x, y: top.y + 120 }) as Vec2;
    const edit = pathEdit(target, moveHandle(target.model, { kind: 'vertex', sub: 0, index: 2 }, apex));
    expect(edit?.id).toBe('element.update');
    expect(t.core.execute(edit?.id ?? '', edit?.args).ok).toBe(true);
    const after = pathTarget(t.core.store, t.shape);
    if (after === undefined) throw new Error('no target after');
    const now = placedPathHandles(after).map((h) => h.page) as Vec2[];
    for (const k of [0, 1]) {
      expect((now[k] as Vec2).x).toBeCloseTo((before[k] as Vec2).x, 1);
      expect((now[k] as Vec2).y).toBeCloseTo((before[k] as Vec2).y, 1);
    }
    expect((now[2] as Vec2).y).toBeCloseTo(top.y + 120, 1);
    const r = path(t.core, t.shape);
    expect(r.path.d.startsWith('M 0 0 ')).toBe(true);
    expect(r.path.w).toBe(100);
    expect(r.path.h).toBeGreaterThan(50);
    expect(r.transform.rot).toBe(30);
  });

  it('FR-SHP-011: double-click enters, a vertex drag is one undo step, Esc mid-drag restores, Esc leaves', () => {
    const t = setup();
    const { session, ctx, tools } = tooling(t);
    expect(enterPathEdit(ctx, t.rect)).toBe(false);
    expect(enterPathEdit(ctx, t.shape)).toBe(true);
    expect(session.selection.get()).toEqual([t.shape]);
    const original = path(t.core, t.shape);
    // the apex is at (200, 200): a press there drags it
    expect(tools.pointer(at('down', 200, 200))).toBe(true);
    expect(tools.current).toBe('select.reshaping');
    expect(session.pathEdit.get()?.point).toEqual({ sub: 0, index: 2 });
    tools.pointer(at('move', 200, 240));
    tools.pointer(at('move', 200, 260));
    tools.pointer(at('up', 200, 260));
    expect(tools.current).toBe('select.idle');
    expect(path(t.core, t.shape).transform.h).toBeCloseTo(160, 6);
    expect(path(t.core, t.shape).path.d).toBe('M 0 0 L 100 0 L 50 80 Z');
    t.core.store.history.undo();
    expect(path(t.core, t.shape)).toEqual(original);
    expect(t.core.store.history.canUndo()).toBe(false);
    tools.pointer(at('down', 300, 100));
    tools.pointer(at('move', 340, 100));
    tools.escape();
    expect(path(t.core, t.shape)).toEqual(original);
    expect(leavePathEdit(ctx)).toBe(true);
    expect(leavePathEdit(ctx)).toBe(false);
    // not editing: the same press is no path press
    tools.pointer(at('down', 200, 200));
    expect(tools.current).not.toBe('select.reshaping');
  });

  it('FR-SHP-011: a press on a segment adds a vertex there, one step with its drag; Delete removes the selected vertex, never the shape', () => {
    const t = setup();
    const { session, ctx, tools } = tooling(t);
    session.selection.set([t.shape]);
    expect(editSelectedPath(ctx)).toBe(true);
    // the top edge, half-way: a new vertex 1 at (200, 100)
    tools.pointer(at('down', 200, 100));
    expect(tools.current).toBe('select.reshaping');
    tools.pointer(at('up', 200, 100));
    expect(path(t.core, t.shape).path.d).toBe('M 0 0 L 50 0 L 100 0 L 50 50 Z');
    expect(session.pathEdit.get()).toEqual({ id: t.shape, point: { sub: 0, index: 1 } });
    expect(removeSelectedPoint(ctx)).toBe(true);
    expect(path(t.core, t.shape).path.d).toBe('M 0 0 L 100 0 L 50 50 Z');
    // no vertex selected: Delete is still taken, and a triangle keeps its three vertices
    expect(removeSelectedPoint(ctx)).toBe(true);
    session.pathEdit.set({ id: t.shape, point: { sub: 0, index: 0 } });
    expect(removeSelectedPoint(ctx)).toBe(true);
    expect(t.core.store.has(t.shape)).toBe(true);
    expect(path(t.core, t.shape).path.d).toBe('M 0 0 L 100 0 L 50 50 Z');
    // a press on another element stops editing
    tools.pointer(at('down', 620, 620));
    tools.pointer(at('up', 620, 620));
    expect(session.pathEdit.get()).toBeUndefined();
    expect(removeSelectedPoint(ctx)).toBe(false);
    session.selection.set([t.shape, t.rect]);
    expect(editSelectedPath(ctx)).toBe(false);
  });

  it('FR-SHP-011 FR-SHP-008: a path locked against edit, size or position is not reshaped; locked mid-edit, presses stop reshaping', () => {
    for (const lock of ['edit', 'size', 'position']) {
      const t = setup();
      const { ctx } = tooling(t);
      expect(t.core.execute('element.update', { id: t.shape, fields: { locks: { [lock]: true } } }).ok).toBe(true);
      expect(enterPathEdit(ctx, t.shape)).toBe(false);
    }
    const t = setup();
    const { session, ctx, tools } = tooling(t);
    expect(enterPathEdit(ctx, t.shape)).toBe(true);
    expect(t.core.execute('element.update', { id: t.shape, fields: { locks: { edit: true } } }).ok).toBe(true);
    const original = path(t.core, t.shape);
    tools.pointer(at('down', 200, 200));
    expect(tools.current).not.toBe('select.reshaping');
    tools.pointer(at('up', 200, 200));
    session.pathEdit.set({ id: t.shape, point: { sub: 0, index: 2 } });
    expect(removeSelectedPoint(ctx)).toBe(false);
    expect(path(t.core, t.shape)).toEqual(original);
  });

  it('FR-SHP-011: while a path is edited the hidden frame handles take no press; a selection change ends the editing', () => {
    const t = setup();
    const { session, ctx, tools } = tooling(t);
    expect(enterPathEdit(ctx, t.shape)).toBe(true);
    // the frame's top-left resize handle would be at (100, 100), the first vertex too: off both, the frame's left-middle (100, 150)
    tools.pointer(at('down', 100, 150));
    expect(tools.current).not.toBe('select.resizing');
    tools.pointer(at('up', 100, 150));
    expect(session.pathEdit.get()?.id).toBe(t.shape);
    // selected another way (the layers panel, Select all): editing ends, and Esc is not taken by a stale path
    session.selection.set([t.rect]);
    expect(session.pathEdit.get()).toBeUndefined();
    session.selection.set([t.shape]);
    expect(session.pathEdit.get()).toBeUndefined();
    expect(leavePathEdit(ctx)).toBe(false);
  });
});
