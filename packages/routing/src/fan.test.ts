// FR-CON-011: connectors between the same two elements, either way round, are moved aside by FAN_SPACING among them when routed; a lone
// connector, one with waypoints and one with a free end keep the route their router gives.
import { createCore, createRegistry, type ShapeDef } from '@fluxion/core';
import type { Vec2 } from '@fluxion/geometry';
import type { AnyRecord, RecordId, Route } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { registerBuiltinRouters } from './builtins.js';
import { type RouteContext, routeConnector } from './connector-route.js';
import { FAN_SPACING, fanOffsetOf } from './fan.js';
import { routePoint } from './labels.js';
import type { Router } from './router.js';

function context(): RouteContext {
  const routers = createRegistry<string, Router>('routers');
  registerBuiltinRouters(routers);
  return { shapeDefs: createRegistry<string, ShapeDef>('shapeDefs'), routers };
}

/** Shapes A and B, `count` connectors from A to B of route type `type`, and one from B to A when `back`. */
function scene(type: Route['type'], count: number, back = false, at: Vec2 = { x: 400, y: 0 }) {
  const b = documentBuilder({ seed: 11 });
  const screen = b.screen({ size: { w: 1000, h: 1000 } });
  const a = b.rect(screen, { x: 0, y: 0, w: 100, h: 100 });
  const c = b.rect(screen, { x: at.x, y: at.y, w: 100, h: 100 });
  const ids = Array.from({ length: count }, () => b.connect(a, c, { route: type }));
  if (back) ids.push(b.connect(c, a, { route: type }));
  const core = createCore(b.build());
  const ctx = context();
  const middle = (id: RecordId): Vec2 => {
    const route = routeConnector(core.store, ctx, id);
    if (route === undefined) throw new Error(`no route for ${id}`);
    return routePoint(route.commands, 0.5).point;
  };
  return { core, ctx, ids, middle };
}

const apart = (p: Vec2, q: Vec2): number => Math.hypot(p.x - q.x, p.y - q.y);

describe('parallel connectors (FR-CON-011)', () => {
  it('FR-CON-011: two straight connectors between A and B no longer overlap: their middles are FAN_SPACING apart', () => {
    const { ids, middle } = scene('straight', 2);
    expect(apart(middle(ids[0] as RecordId), middle(ids[1] as RecordId))).toBeCloseTo(FAN_SPACING, 6);
  });

  it('FR-CON-011: a connector from B back to A is parallel too, and three spread evenly around the line between the shapes', () => {
    const { ids, middle } = scene('curved', 2, true);
    const ys = ids.map((id) => middle(id).y).sort((p, q) => p - q);
    // the shapes' centres are level at y 50: the middle connector stays on the line, the others FAN_SPACING to either side
    expect(ys[1]).toBeCloseTo(50, 6);
    expect((ys[1] as number) - (ys[0] as number)).toBeCloseTo(FAN_SPACING, 1);
    expect((ys[2] as number) - (ys[1] as number)).toBeCloseTo(FAN_SPACING, 1);
  });

  it('FR-CON-011: orthogonal connectors between shapes that need a bend move their inner segments apart', () => {
    const { ids, middle } = scene('orthogonal', 2, false, { x: 400, y: 300 });
    expect(apart(middle(ids[0] as RecordId), middle(ids[1] as RecordId))).toBeGreaterThanOrEqual(FAN_SPACING - 1e-6);
  });

  it('FR-CON-011: a lone connector, one with waypoints and one with a free end are not moved aside', () => {
    const lone = scene('straight', 1);
    expect(fanOffsetOf(lone.core.store, lone.ids[0] as RecordId)).toBeUndefined();
    expect(lone.middle(lone.ids[0] as RecordId).y).toBeCloseTo(50, 6);

    const placed = scene('straight', 3);
    const [first, second, third] = placed.ids as [RecordId, RecordId, RecordId];
    placed.core.store.transact('waypoint', (tx) => tx.patch(first, { route: { type: 'straight', waypoints: [{ x: 250, y: 300 }] } }));
    expect(fanOffsetOf(placed.core.store, first)).toBeUndefined();
    // the two left are a pair of their own
    expect([fanOffsetOf(placed.core.store, second), fanOffsetOf(placed.core.store, third)].sort()).toEqual([-FAN_SPACING / 2, FAN_SPACING / 2]);

    const free = scene('straight', 2);
    const unbound = free.core.store
      .members('bindingsByElement', free.ids[1] as RecordId)
      .find((id) => (free.core.store.get(id) as { end?: string }).end === 'target');
    free.core.store.transact('unbind', (tx) => {
      tx.delete(unbound as RecordId);
      tx.patch(free.ids[1] as RecordId, { freeTarget: { x: 450, y: 50 } });
    });
    expect(fanOffsetOf(free.core.store, free.ids[0] as RecordId)).toBeUndefined();
  });

  it('FR-CON-011: a store query routing a connector moves it aside once a second connector joins the same shapes', () => {
    const { core, ctx, ids } = scene('straight', 1);
    const routed = core.store.query((view) => routePoint(routeConnector(view, ctx, ids[0] as RecordId)?.commands ?? [], 0.5).point);
    expect(routed().y).toBeCloseTo(50, 6);
    const before = routed();
    // a second connector from A to B, bound as the builder binds them
    const bindings = core.store.members('bindingsByElement', ids[0] as RecordId).map((id) => core.store.get(id) as AnyRecord);
    const connector = core.store.get(ids[0] as RecordId) as AnyRecord;
    core.store.transact('second', (tx) => {
      tx.put({ ...connector, id: 'fansecondconn01' as RecordId } as AnyRecord);
      for (const bnd of bindings) tx.put({ ...bnd, id: `${bnd.id}x` as RecordId, connectorId: 'fansecondconn01' } as AnyRecord);
    });
    expect(Math.abs(routed().y - before.y)).toBeCloseTo(FAN_SPACING / 2, 6);
  });

  it('NFR-PERF-005: a spoke of a hub reads the bindings of its leaf, not of the hub: the offset of each of 200 spokes reads a few records (M16.40)', () => {
    const b = documentBuilder({ seed: 7 });
    const screen = b.screen();
    const hub = b.rect(screen, { x: 0, y: 0, w: 100, h: 100 });
    const spokes = Array.from({ length: 200 }, (_, k) => b.connect(hub, b.rect(screen, { x: 300, y: 10 * k, w: 20, h: 8 })));
    const { store } = createCore(b.build());
    let reads = 0;
    const counted = new Proxy(store, {
      get: (target, key) => {
        const value = Reflect.get(target, key) as unknown;
        if (key !== 'get') return typeof value === 'function' ? value.bind(target) : value;
        return (...args: unknown[]) => {
          reads++;
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
    for (const id of spokes) expect(fanOffsetOf(counted, id)).toBeUndefined();
    // the records read: the hub's 200 bindings and their connectors read for every spoke would be over 80,000
    expect(reads).toBeLessThan(200 * 20);
  });

  it('FR-CON-011: a fanned curved connector keeps the tangent its author set at the target on the target', () => {
    const { core, ctx, ids } = scene('curved', 2);
    const id = ids[0] as RecordId;
    const pull = { x: 0, y: -80 };
    core.store.transact('tangent', (tx) => tx.patch(id, { route: { type: 'curved', tangents: { '1': pull } } }));
    const route = routeConnector(core.store, ctx, id);
    const last = route?.commands.at(-1);
    if (route === undefined || last?.kind !== 'C') throw new Error('expected a curve');
    // the target arrives by its tangent (ADR-0168), and the bow's waypoint is not pulled by it
    expect(last.control2).toEqual({ x: route.target.point.x + pull.x, y: route.target.point.y + pull.y });
    expect(route.commands).toHaveLength(3);
    const into = route.commands[1];
    if (into?.kind !== 'C') throw new Error('expected a curve');
    expect(Math.hypot(into.control2.x - into.to.x - pull.x, into.control2.y - into.to.y - pull.y)).toBeGreaterThan(1);
  });
});
