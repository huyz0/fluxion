import { createCore, type ShapeDef } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { registerBuiltinTools } from './builtin-tools.js';
import type { PointerInfo, PointerPhase } from './pointer.js';
import { QUICK_OFFSET_PX, quickHandles } from './quick-connect.js';
import { pickQuick, quickItems } from './quick-connect-menu.js';
import { createSession } from './session.js';
import { createToolDispatcher, createToolRegistry } from './tools.js';

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

/** Two boxes 100 × 100 at (0, 0) and (400, 0), the select tool on a real core, hit-testing by boxes, the camera at 100 %. */
function setup() {
  const b = documentBuilder({ seed: 1924 });
  const screen = b.screen();
  const a = b.rect(screen, { x: 0, y: 0, w: 100, h: 100 });
  const c = b.rect(screen, { x: 400, y: 0, w: 100, h: 100 });
  const core = createCore(b.build());
  const session = createSession('doc');
  let n = 0;
  const registry = createToolRegistry();
  registerBuiltinTools(registry);
  const box = (id: RecordId) => (core.store.get(id) as unknown as { transform: { x: number; y: number; w: number; h: number } }).transform;
  const elements = () => core.store.members('byType', 'element');
  const hitTest = (p: { x: number; y: number }) =>
    elements().find((id) => {
      const t = box(id);
      return (core.store.get(id) as { kind?: string }).kind === 'shape' && p.x >= t.x && p.x <= t.x + t.w && p.y >= t.y && p.y <= t.y + t.h;
    });
  const tools = createToolDispatcher(registry, {
    session,
    view: core.store,
    execute: core.execute,
    seal: () => core.store.history.seal(),
    newId: () => `quickquickquick${String(++n).padStart(2, '0')}` as RecordId,
    screen,
    hitTest,
    elementsIn: () => [],
    allElements: () => [],
  });
  const bindings = (connector: RecordId) =>
    core.store
      .members('byType', 'binding')
      .map((x) => core.store.get(x) as unknown as { connectorId: string; end: string; elementId: string })
      .filter((x) => x.connectorId === connector)
      .map((x) => [x.end, x.elementId])
      .sort();
  const kinds = (kind: string) => elements().filter((id) => (core.store.get(id) as { kind?: string }).kind === kind);
  // the east "+" of `a`: its side's middle (100, 50) and QUICK_OFFSET_PX beyond
  const east = { x: 100 + QUICK_OFFSET_PX, y: 50 };
  const dragFromEast = (to: [number, number]) => {
    tools.pointer(at('move', 50, 50));
    tools.pointer(at('move', east.x, east.y));
    tools.pointer(at('down', east.x, east.y));
    tools.pointer(at('move', ...to));
    tools.pointer(at('up', ...to));
  };
  const defs = { get: (id: string) => ({ id, defaultSize: { w: 160, h: 100 } }) as unknown as ShapeDef };
  return { core, a, c, session, tools, box, bindings, kinds, east, dragFromEast, defs };
}

describe('quick-connect (FR-EDT-015)', () => {
  it('FR-EDT-015: a hovered shape has a "+" beyond the middle of each side; a selected one has none', () => {
    const t = setup();
    expect(quickHandles(t.core.store, t.a, { x: 0, y: 0, z: 1 }).map((h) => [h.side, h.at.x, h.at.y])).toEqual([
      ['n', 50, -QUICK_OFFSET_PX],
      ['e', 100 + QUICK_OFFSET_PX, 50],
      ['s', 50, 100 + QUICK_OFFSET_PX],
      ['w', -QUICK_OFFSET_PX, 50],
    ]);
    // at 200 % the "+" is as far from the shape on the canvas: half as far on the page
    expect(quickHandles(t.core.store, t.a, { x: 0, y: 0, z: 2 })[1]?.at.x).toBe(100 + QUICK_OFFSET_PX / 2);
    // moving from the shape onto its "+" keeps it hovered, though the "+" and the way there are off the shape; further off, not
    t.tools.pointer(at('move', 50, 50));
    t.tools.pointer(at('move', 100 + QUICK_OFFSET_PX / 2, 50));
    t.tools.pointer(at('move', t.east.x, t.east.y));
    expect(t.session.hover.get()).toBe(t.a);
    t.tools.pointer(at('move', 200, 50));
    expect(t.session.hover.get()).toBeUndefined();
    t.tools.pointer(at('move', 50, 50));
    t.tools.pointer(at('move', t.east.x, t.east.y));
    // a press on the "+" of a selected shape is a press beside it: no connector is drawn
    t.session.selection.set([t.a]);
    t.tools.pointer(at('down', t.east.x, t.east.y));
    expect(t.tools.current).not.toBe('select.quickConnecting');
  });

  it('FR-EDT-015: the east "+" dragged onto another shape joins the two with a bound connector in one undo step', () => {
    const t = setup();
    const depth = t.core.store.history.undoDepth;
    t.dragFromEast([450, 50]);
    const [line] = t.kinds('connector');
    expect(t.bindings(line as RecordId)).toEqual([
      ['source', t.a],
      ['target', t.c],
    ]);
    expect(t.core.store.history.undoDepth).toBe(depth + 1);
    expect(t.session.quickDrop.get()).toBeUndefined();
  });

  it('FR-EDT-015: dropped on nothing, the mini library opens; Same shape adds the source’s shape beyond the drop, joined, one undo step', () => {
    const t = setup();
    t.dragFromEast([250, 300]);
    const drop = t.session.quickDrop.get();
    expect(drop).toMatchObject({ source: t.a, side: 'e', at: { x: 250, y: 300 } });
    expect(quickItems(t.defs, true).map((i) => i.title)).toEqual(['Same shape', 'Rectangle', 'Rounded rectangle', 'Ellipse', 'Diamond', 'Connector only']);
    const depth = t.core.store.history.undoDepth;
    pickQuick(t.tools, t.defs, drop as NonNullable<typeof drop>, 'quick.same');
    const added = t.kinds('shape').filter((x) => x !== t.a && x !== t.c);
    expect(added).toHaveLength(1);
    const shape = added[0] as RecordId;
    // the drag went mostly down: the new shape's top middle is at the drop point, at the source's size
    expect(t.box(shape)).toMatchObject({ x: 200, y: 300, w: 100, h: 100 });
    const [line] = t.kinds('connector');
    expect(t.bindings(line as RecordId)).toEqual([
      ['source', t.a],
      ['target', shape],
    ]);
    expect([t.session.selection.get(), t.session.quickDrop.get()]).toEqual([[shape], undefined]);
    expect(t.core.store.history.undoDepth).toBe(depth + 1);
    t.core.store.history.undo();
    expect([t.kinds('shape').length, t.kinds('connector').length]).toEqual([2, 0]);
  });

  it('FR-EDT-015: a basic shape from the mini library has its default size; Connector only leaves the end free at the drop', () => {
    const t = setup();
    t.dragFromEast([300, 60]);
    pickQuick(t.tools, t.defs, t.session.quickDrop.get() as never, 'quick.shape:basic:ellipse');
    const shape = t.kinds('shape').find((x) => x !== t.a && x !== t.c) as RecordId;
    // the drag went mostly right: the new shape's left middle is at the drop point
    expect(t.box(shape)).toMatchObject({ x: 300, y: 10, w: 160, h: 100 });
    expect((t.core.store.get(shape) as { defId?: string }).defId).toBe('basic:ellipse');
    t.dragFromEast([250, 300]);
    pickQuick(t.tools, t.defs, t.session.quickDrop.get() as never, 'quick.none');
    const free = t.kinds('connector').find((x) => t.bindings(x).length === 1) as RecordId;
    expect(t.bindings(free)).toEqual([['source', t.a]]);
    expect((t.core.store.get(free) as { freeTarget?: unknown }).freeTarget).toEqual({ x: 250, y: 300 });
  });

  it('FR-EDT-015: a press on a nearby selected shape’s handle resizes it, though it is within reach of the hovered shape’s "+"', () => {
    const t = setup();
    // c moved beside a: its west resize handle (130, 50) lies 8 px from a's east "+"
    t.core.execute('element.update', { id: t.c, fields: { transform: { x: 130, y: 0, w: 100, h: 100 } } });
    t.session.selection.set([t.c]);
    t.tools.pointer(at('move', 50, 50));
    t.tools.pointer(at('move', 128, 50));
    expect(t.session.hover.get()).toBe(t.a);
    t.tools.pointer(at('down', 128, 50));
    expect(t.tools.current).toBe('select.resizing');
  });
  it('FR-EDT-015: a click on a "+" without a drag goes back to idle and opens nothing', () => {
    const t = setup();
    t.tools.pointer(at('move', 50, 50));
    t.tools.pointer(at('move', t.east.x + 4, t.east.y + 3));
    t.tools.pointer(at('down', t.east.x + 4, t.east.y + 3));
    t.tools.pointer(at('up', t.east.x + 5, t.east.y + 3));
    expect([t.tools.current, t.session.quickDrop.get(), t.kinds('connector')]).toEqual(['select.idle', undefined, []]);
  });

  it('FR-EDT-015: a drag dropped back on its own shape adds nothing and opens nothing', () => {
    const t = setup();
    const depth = t.core.store.history.undoDepth;
    t.dragFromEast([50, 50]);
    expect([t.session.quickDrop.get(), t.kinds('connector'), t.core.store.history.undoDepth]).toEqual([undefined, [], depth]);
  });

  it('FR-EDT-015: a "+" lying over a nearby shape stays the hovered shape’s, and a press on it starts a quick connect', () => {
    const t = setup();
    // c moved so that a's east "+" lies over it
    t.core.execute('element.update', { id: t.c, fields: { transform: { x: 110, y: 0, w: 100, h: 100 } } });
    t.tools.pointer(at('move', 50, 50));
    t.tools.pointer(at('move', t.east.x, t.east.y));
    expect(t.session.hover.get()).toBe(t.a);
    t.tools.pointer(at('down', t.east.x, t.east.y));
    expect(t.tools.current).toBe('select.quickConnecting');
  });
});
