import { createCore, createRegistry, type ShapeDef } from '@fluxion/core';
import type { Vec2 } from '@fluxion/geometry';
import { type Router, registerBuiltinRouters, routeConnector } from '@fluxion/routing';
import type { ConnectorElement, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { registerBuiltinTools } from './builtin-tools.js';
import { type ConnectorHandle, connectorHandleAt, connectorHandlesOf, endDrop, handleEdit, waypointEdit } from './connector-handles.js';
import type { ParamCommand } from './param-handles.js';
import type { PointerInfo, PointerPhase } from './pointer.js';
import { createSession } from './session.js';
import { createToolDispatcher, createToolRegistry } from './tools.js';

const rect = {
  id: 'test:rect',
  outline: { path: 'M 0 0 H {w} V {h} H 0 Z' },
  defaultSize: { w: 100, h: 100 },
  anchors: [{ name: 'tip', x: 1, y: 0 }],
} as ShapeDef;
/** The built-in routers, registered. */
function builtinRouters() {
  const routers = createRegistry<string, Router>('routers');
  registerBuiltinRouters(routers);
  return routers;
}

const defs = { get: (id: string) => (id === 'test:rect' ? rect : undefined) };

function setup(route?: object) {
  const b = documentBuilder({ seed: 18 });
  const s = b.screen();
  const a = b.rect(s, { x: 0, y: 0, w: 100, h: 100, defId: 'test:rect' });
  const c = b.rect(s, { x: 400, y: 0, w: 100, h: 100, defId: 'test:rect' });
  const d = b.rect(s, { x: 400, y: 300, w: 100, h: 100, defId: 'test:rect' });
  const line = b.connect(a, c, { route: 'straight' });
  const doc = b.build();
  const rec = doc.records[line] as unknown as { route: object };
  const core = createCore({ ...doc, records: { ...doc.records, [line]: { ...rec, route: { ...rec.route, ...route } } } } as typeof doc);
  const read = (id: RecordId) => routeConnector(core.store, { shapeDefs: { get: defs.get } as never, routers: builtinRouters() }, id);
  return { core, a, c, d, line, read, s };
}

describe('connector handles (FR-CON-007)', () => {
  it('FR-CON-007: a connector has a handle at each end and one in the middle of each stretch', () => {
    const { core, line, read, a } = setup();
    const handles = connectorHandlesOf(core.store, read, line);
    expect(handles.map((h) => [h.role, h.at])).toEqual([
      ['end', 'source'],
      ['end', 'target'],
      ['mid', 0],
    ]);
    const [source, target, mid] = handles;
    expect(mid?.page.x).toBeCloseTo(((source?.page.x ?? 0) + (target?.page.x ?? 0)) / 2, 6);
    expect(mid?.page.y).toBeCloseTo(((source?.page.y ?? 0) + (target?.page.y ?? 0)) / 2, 6);
    // a waypoint splits the stretch in two
    const bent = setup({ type: 'polyline', waypoints: [{ x: 250, y: 200 }] });
    expect(connectorHandlesOf(bent.core.store, bent.read, bent.line).map((h) => [h.role, h.at])).toEqual([
      ['end', 'source'],
      ['end', 'target'],
      ['way', 0],
      ['mid', 0],
      ['mid', 1],
    ]);
    // not a connector, not there, or not routable: none
    expect(connectorHandlesOf(core.store, read, a)).toEqual([]);
    expect(connectorHandlesOf(core.store, read, 'gone' as RecordId)).toEqual([]);
    expect(connectorHandlesOf(core.store, () => undefined, line)).toEqual([]);
  });

  it('FR-CON-007: the handle under a point is the nearest within reach; an end beats a middle at the same distance', () => {
    const handles: ConnectorHandle[] = [
      { role: 'end', at: 'source', page: { x: 0, y: 0 } },
      { role: 'mid', at: 0, page: { x: 10, y: 0 } },
      { role: 'end', at: 'target', page: { x: 20, y: 0 } },
    ];
    expect(connectorHandleAt(handles, { x: 8, y: 0 }, 5)?.at).toBe(0);
    expect(connectorHandleAt(handles, { x: 1, y: 0 }, 5)?.at).toBe('source');
    expect(connectorHandleAt(handles, { x: 50, y: 0 }, 5)).toBeUndefined();
    // equally far from a middle and an end: the end, whichever comes first
    const tie = [handles[1], handles[2]] as ConnectorHandle[];
    expect(connectorHandleAt(tie, { x: 15, y: 0 }, 6)?.at).toBe('target');
    expect(connectorHandleAt([...tie].reverse(), { x: 15, y: 0 }, 6)?.at).toBe('target');
    // exactly at reach is on it
    expect(connectorHandleAt([handles[0] as ConnectorHandle], { x: 5, y: 0 }, 5)?.at).toBe('source');
  });

  it('FR-CON-007: a waypoint is made in its stretch from the route as it began; a straight route becomes a polyline', () => {
    const edit = waypointEdit('c' as RecordId, { type: 'straight' }, 0, { x: 5, y: 6 });
    expect(edit).toEqual({ id: 'element.update', args: { id: 'c', fields: { route: { type: 'polyline', waypoints: [{ x: 5, y: 6 }] } } } });
    const original = {
      type: 'curved',
      cornerRadius: 4,
      waypoints: [
        { x: 1, y: 1 },
        { x: 9, y: 9 },
      ],
    } as ConnectorElement['route'];
    expect(waypointEdit('c' as RecordId, original, 1, { x: 5, y: 5 }).args).toEqual({
      id: 'c',
      fields: {
        route: {
          type: 'curved',
          cornerRadius: 4,
          waypoints: [
            { x: 1, y: 1 },
            { x: 5, y: 5 },
            { x: 9, y: 9 },
          ],
        },
      },
    });
    // the original is not touched, so the next frame of a drag starts from it again
    expect(original.waypoints).toHaveLength(2);
  });

  it('FR-CON-007: waypoints have handles; an orthogonal route has handles on its inner segments instead of its stretches', () => {
    const bent = setup({ type: 'polyline', waypoints: [{ x: 250, y: 200 }] });
    expect(connectorHandlesOf(bent.core.store, bent.read, bent.line).map((h) => [h.role, h.at])).toEqual([
      ['end', 'source'],
      ['end', 'target'],
      ['way', 0],
      ['mid', 0],
      ['mid', 1],
    ]);
    // an elbow between shapes at different heights: source stub, a vertical middle, target stub
    const b = documentBuilder({ seed: 20 });
    const s = b.screen();
    const left = b.rect(s, { x: 0, y: 0, w: 100, h: 100 });
    const right = b.rect(s, { x: 400, y: 200, w: 100, h: 100 });
    const elbow = b.connect(left, right, { route: 'orthogonal' });
    const doc = b.build();
    const core = createCore(doc);
    const read = (id: RecordId) => routeConnector(core.store, { shapeDefs: { get: () => undefined } as never, routers: builtinRouters() }, id);
    const handles = connectorHandlesOf(core.store, read, elbow);
    const segs = handles.filter((h) => h.role === 'seg');
    expect(handles.filter((h) => h.role === 'mid')).toEqual([]);
    expect(segs).toHaveLength(1);
    expect(segs[0]?.axis).toBe('x');
    const [source, target] = [handles[0] as ConnectorHandle, handles[1] as ConnectorHandle];
    expect((segs[0] as ConnectorHandle).page.x).toBeGreaterThan(source.page.x);
    expect((segs[0] as ConnectorHandle).page.x).toBeLessThan(target.page.x);
    // a waypoint, then a segment: the order is ends, waypoints, the rest; at an equal distance a waypoint beats a middle
    const way: ConnectorHandle = { role: 'way', at: 0, page: { x: 10, y: 0 } };
    const mid: ConnectorHandle = { role: 'mid', at: 0, page: { x: 10, y: 0 } };
    const seg: ConnectorHandle = { role: 'seg', at: 1, page: { x: 10, y: 0 }, axis: 'y' };
    for (const order of [
      [mid, way],
      [way, mid],
      [seg, way],
      [way, seg],
    ])
      expect(connectorHandleAt(order, { x: 10, y: 0 }, 5)?.role).toBe('way');
    const end: ConnectorHandle = { role: 'end', at: 'source', page: { x: 10, y: 0 } };
    expect(connectorHandleAt([way, end], { x: 10, y: 0 }, 5)?.role).toBe('end');
  });

  it('FR-CON-007: dragging a handle edits the route as it began: a waypoint moves, a segment moves across, a middle makes one', () => {
    const id = 'c' as RecordId;
    const route = {
      type: 'orthogonal',
      waypoints: [
        { x: 10, y: 10 },
        { x: 90, y: 90 },
      ],
    } as ConnectorElement['route'];
    const edit = (handle: ConnectorHandle, original = route) =>
      ((handleEdit(id, original, handle, { x: 50, y: 60 }) as ParamCommand).args as { fields: { route: ConnectorElement['route'] } }).fields.route;
    // a waypoint moves to the pointer
    expect(edit({ role: 'way', at: 1, page: { x: 90, y: 90 } }).waypoints).toEqual([
      { x: 10, y: 10 },
      { x: 50, y: 60 },
    ]);
    // a vertical segment takes the pointer's x and the waypoint keeps its own y, so the segments on either side of it
    // stay; the waypoint nearest the segment is the one that moves, the other is left alone
    expect(edit({ role: 'seg', at: 2, page: { x: 85, y: 80 }, axis: 'x' }).waypoints).toEqual([
      { x: 10, y: 10 },
      { x: 50, y: 90 },
    ]);
    expect(edit({ role: 'seg', at: 2, page: { x: 12, y: 15 }, axis: 'y' }).waypoints).toEqual([
      { x: 10, y: 60 },
      { x: 90, y: 90 },
    ]);
    // with no waypoint yet, the segment makes one, and the route keeps its type
    const none = { type: 'orthogonal' } as ConnectorElement['route'];
    expect(edit({ role: 'seg', at: 2, page: { x: 85, y: 80 }, axis: 'x' }, none)).toEqual({ type: 'orthogonal', waypoints: [{ x: 50, y: 80 }] });
    // a middle inserts at its index; an end is the end drop`s
    expect(edit({ role: 'mid', at: 1, page: { x: 0, y: 0 } }).waypoints).toEqual([
      { x: 10, y: 10 },
      { x: 50, y: 60 },
      { x: 90, y: 90 },
    ]);
    expect(handleEdit(id, route, { role: 'end', at: 'source', page: { x: 0, y: 0 } }, { x: 1, y: 1 })).toBeUndefined();
    // the original is not touched
    expect(route.waypoints).toEqual([
      { x: 10, y: 10 },
      { x: 90, y: 90 },
    ]);
  });

  it('FR-CON-007: an end dropped on an element binds at the element anchor nearest the drop', () => {
    const { core, line, c, d } = setup();
    let n = 0;
    const newId = () => `bindingbinding${String(++n).padStart(2, '0')}` as RecordId;
    // near the top-right corner of d, where the definition's own anchor tip is
    const [bind] = endDrop(core.store, defs, { connector: line, end: 'target', onto: d, at: { x: 497, y: 303 }, newId });
    expect(bind?.id).toBe('binding.set');
    expect(bind?.args).toMatchObject({ connectorId: line, end: 'target', elementId: d, anchor: { kind: 'named', name: 'tip' } });
    // near the left side: the default anchor w
    const [west] = endDrop(core.store, defs, { connector: line, end: 'target', onto: d, at: { x: 380, y: 352 }, newId });
    expect(west?.args).toMatchObject({ anchor: { kind: 'named', name: 'w' } });
    // near the middle: the centre
    const [centre] = endDrop(core.store, defs, { connector: line, end: 'target', onto: c, at: { x: 450, y: 50 }, newId });
    expect(centre?.args).toMatchObject({ elementId: c, anchor: { kind: 'named', name: 'center' } });
    // running it re-points the end: the connector has its two bindings still
    expect(core.execute(bind?.id as string, bind?.args).ok).toBe(true);
    expect(core.store.members('bindingsByElement', line).length).toBe(2);
    // a shape without a registered definition still has the default anchors
    const [plain] = endDrop(core.store, { get: () => undefined }, { connector: line, end: 'source', onto: d, at: { x: 450, y: 300 }, newId });
    expect(plain?.args).toMatchObject({ anchor: { kind: 'named', name: 'n' } });
  });

  it('FR-CON-007: dropped on nothing, a free end moves to the drop and a bound one stays', () => {
    const { core, line } = setup();
    const newId = () => 'x' as RecordId;
    expect(endDrop(core.store, defs, { connector: line, end: 'target', onto: undefined, at: { x: 1, y: 2 }, newId })).toEqual([]);
    expect(endDrop(core.store, defs, { connector: line, end: 'source', onto: 'gone' as RecordId, at: { x: 1, y: 2 }, newId })).toEqual([]);
    // a connector with a free end
    const b = documentBuilder({ seed: 19 });
    const s = b.screen();
    const a = b.rect(s, {});
    const free = b.connect(a, { x: 300, y: 300 });
    const freeCore = createCore(b.build());
    const [move] = endDrop(freeCore.store, defs, { connector: free, end: 'target', onto: undefined, at: { x: 7, y: 8 }, newId });
    expect(move).toEqual({ id: 'element.update', args: { id: free, fields: { freeTarget: { x: 7, y: 8 } } } });
    expect(endDrop(freeCore.store, defs, { connector: free, end: 'source', onto: undefined, at: { x: 7, y: 8 }, newId })).toEqual([]);
  });
});

const at = (phase: PointerPhase, p: Vec2, o: Partial<PointerInfo> = {}): PointerInfo => ({
  phase,
  pointerId: 1,
  pointerType: 'mouse',
  screen: p,
  page: p,
  button: 0,
  buttons: phase === 'up' ? 0 : 1,
  shift: false,
  alt: false,
  mod: false,
  pressure: 0.5,
  coalesced: [],
  ...o,
});

describe('dragging connector handles with the select tool (FR-CON-007)', () => {
  function tools() {
    const o = setup();
    const session = createSession('doc');
    const registry = createToolRegistry();
    registerBuiltinTools(registry);
    let n = 0;
    const dispatcher = createToolDispatcher(registry, {
      session,
      view: o.core.store,
      execute: o.core.execute,
      seal: () => o.core.store.history.seal(),
      newId: () => `bindingbinding${String(++n).padStart(2, '0')}` as RecordId,
      hitTest: (p) => (p.x >= 400 && p.x <= 500 && p.y >= 300 && p.y <= 400 ? o.d : undefined),
      elementsIn: () => [],
      screen: undefined,
      allElements: () => [],
      shapeDefs: defs,
      route: o.read,
    });
    session.selection.set([o.line]);
    return { ...o, session, dispatcher };
  }
  const route = (core: ReturnType<typeof setup>['core'], id: RecordId) => (core.store.get(id) as unknown as ConnectorElement).route;
  const boundTo = (core: ReturnType<typeof setup>['core'], id: RecordId) =>
    core.store.members('bindingsByElement', id).map((b) => (core.store.get(b) as unknown as { elementId: string }).elementId);

  it('FR-CON-007: dragging the target end onto another shape re-binds it, one undo step; the sketch and hover show it on the way', () => {
    const { core, session, dispatcher, line: id, d, read } = tools();
    const target = connectorHandlesOf(core.store, read, id)[1]?.page as Vec2;
    expect(dispatcher.pointer(at('down', target))).toBe(true);
    expect(dispatcher.current).toBe('select.ending');
    dispatcher.pointer(at('move', { x: 450, y: 350 }));
    expect(session.hover.get()).toBe(d);
    expect(session.sketch.get()?.length).toBe(2);
    dispatcher.pointer(at('up', { x: 450, y: 350 }));
    expect(dispatcher.current).toBe('select.idle');
    expect(session.sketch.get()).toBeUndefined();
    expect(session.hover.get()).toBeUndefined();
    expect(boundTo(core, id)).toContain(d);
    core.store.history.undo();
    expect(boundTo(core, id)).not.toContain(d);
    // Esc mid-drag changes nothing
    const again = connectorHandlesOf(core.store, read, id)[1]?.page as Vec2;
    dispatcher.pointer(at('down', again));
    dispatcher.pointer(at('move', { x: 450, y: 350 }));
    dispatcher.escape();
    expect(dispatcher.current).toBe('select.idle');
    expect(session.sketch.get()).toBeUndefined();
    expect(boundTo(core, id)).not.toContain(d);
  });

  it('FR-CON-007: a click on an end handle, without a drag, changes nothing: the end keeps its anchor', () => {
    const { core, dispatcher, line: id, read } = tools();
    const target = connectorHandlesOf(core.store, read, id)[1]?.page as Vec2;
    const before = JSON.stringify(core.store.toDocument());
    dispatcher.pointer(at('down', target));
    dispatcher.pointer(at('move', { x: target.x + 1, y: target.y + 1 }));
    dispatcher.pointer(at('up', { x: target.x + 1, y: target.y + 1 }));
    expect(dispatcher.current).toBe('select.idle');
    expect(JSON.stringify(core.store.toDocument())).toBe(before);
    expect(core.store.history.canUndo()).toBe(false);
  });

  it('FR-CON-007: dragging a middle makes a waypoint as one undo step; Esc puts the route back', () => {
    const { core, session, dispatcher, line: id, read } = tools();
    const mid = connectorHandlesOf(core.store, read, id)[2]?.page as Vec2;
    expect(dispatcher.pointer(at('down', mid))).toBe(true);
    expect(dispatcher.current).toBe('select.bending');
    dispatcher.pointer(at('move', { x: 250, y: 150 }));
    dispatcher.pointer(at('move', { x: 260, y: 160 }));
    expect(route(core, id)).toMatchObject({ type: 'polyline', waypoints: [{ x: 260, y: 160 }] });
    dispatcher.pointer(at('up', { x: 260, y: 160 }));
    core.store.history.undo();
    expect(route(core, id).waypoints).toBeUndefined();
    expect(core.store.history.canUndo()).toBe(false);
    // Esc mid-drag restores
    dispatcher.pointer(at('down', mid));
    dispatcher.pointer(at('move', { x: 250, y: 150 }));
    expect(route(core, id).waypoints).toHaveLength(1);
    dispatcher.escape();
    expect(route(core, id).waypoints).toBeUndefined();
    expect(dispatcher.current).toBe('select.idle');
    // a press away from the handles is not a handle press; neither is one with the connector not alone
    dispatcher.pointer(at('down', { x: 1000, y: 1000 }));
    expect(dispatcher.current).not.toBe('select.bending');
    dispatcher.pointer(at('up', { x: 1000, y: 1000 }));
    session.selection.set([id, 'other' as RecordId]);
    dispatcher.pointer(at('down', mid));
    expect(dispatcher.current).not.toBe('select.bending');
  });
});
