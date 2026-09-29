import { createCore, createRegistry, type ShapeDef } from '@fluxion/core';
import type { PathCommand } from '@fluxion/geometry';
import type { DocumentFile, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { registerBuiltinRouters } from './builtins.js';
import { type RouteContext, routeConnector } from './connector-route.js';
import { type Router, straightRouter } from './router.js';

const ellipse = {
  id: 'test:ellipse',
  outline: { path: 'M 0 {h/2} A {w/2} {h/2} 0 1 1 {w} {h/2} A {w/2} {h/2} 0 1 1 0 {h/2} Z' },
  defaultSize: { w: 100, h: 60 },
} as ShapeDef;

/** A zigzag through the midpoint, pushed 10 px up: a router no built-in draws. */
const zigzag: Router = {
  route: ({ source, target }) => {
    const mid = { x: (source.point.x + target.point.x) / 2, y: (source.point.y + target.point.y) / 2 - 10 };
    return [
      { kind: 'M', to: source.point },
      { kind: 'L', to: mid },
      { kind: 'L', to: target.point },
    ];
  },
};

function context(): RouteContext {
  const shapeDefs = createRegistry<string, ShapeDef>('shapeDefs');
  shapeDefs.register('test:ellipse', ellipse, 'test');
  const routers = createRegistry<string, Router>('routers');
  registerBuiltinRouters(routers);
  return { shapeDefs, routers };
}

/** A 100 x 100 rect at the origin and a connector from it to (300, 50); `edit` changes the built records. */
function scene(edit: (records: Record<string, Record<string, unknown>>, ids: { rect: RecordId; line: RecordId }) => void = () => undefined) {
  const b = documentBuilder({ seed: 517 });
  const screenId = b.screen();
  const rect = b.rect(screenId, { x: 0, y: 0, w: 100, h: 100 });
  const line = b.connect(rect, { x: 300, y: 50 });
  const doc = b.build();
  edit(doc.records as never, { rect, line });
  return { store: createCore(doc as DocumentFile).store, rect, line };
}

/** `v` with every number rounded to 1e-9 and -0 as 0, so float noise compares equal (NaN stays NaN, M5.17 review F2). */
const r9 = <T>(v: T): T => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === 'number' ? Math.round(x * 1e9) / 1e9 + 0 : x)));

const lineTo = (c: PathCommand | undefined) => (c?.kind === 'L' ? c.to : undefined);

describe('routers by route type (FR-RTE-001)', () => {
  it('FR-RTE-001: routeConnector routes with the router registered for the route type', () => {
    const ctx = context();
    ctx.routers.register('test:zigzag', zigzag, 'test');
    const { store, line } = scene((records, ids) => {
      (records[ids.line] as { route: unknown }).route = { type: 'test:zigzag' };
    });
    const routed = store.query((view) => routeConnector(view, ctx, line))();
    expect(r9(routed?.commands)).toEqual([
      { kind: 'M', to: { x: 100, y: 50 } },
      { kind: 'L', to: { x: 200, y: 40 } },
      { kind: 'L', to: { x: 300, y: 50 } },
    ]);
    // straight is built in, from source to target
    expect(straightRouter.route({ source: { point: { x: 1, y: 2 } }, target: { point: { x: 3, y: 4 } }, route: { type: 'straight' } })).toEqual([
      { kind: 'M', to: { x: 1, y: 2 } },
      { kind: 'L', to: { x: 3, y: 4 } },
    ]);
  });

  it('FR-RTE-001: an unregistered route type, a throwing router or a path that does not start at the source draws straight', () => {
    const ctx = context();
    ctx.routers.register(
      'test:boom',
      {
        route: () => {
          throw new Error('boom');
        },
      },
      'test',
    );
    ctx.routers.register('test:empty', { route: () => [] }, 'test');
    // lines from the source point, but no move to it
    ctx.routers.register(
      'test:lines',
      {
        route: ({ source, target }) => [
          { kind: 'L', to: source.point },
          { kind: 'L', to: target.point },
        ],
      },
      'test',
    );
    ctx.routers.register(
      'test:left',
      {
        route: ({ source, target }) => [
          { kind: 'M', to: { x: 0, y: source.point.y } },
          { kind: 'L', to: target.point },
        ],
      },
      'test',
    );
    ctx.routers.register(
      'test:beside',
      {
        route: ({ source, target }) => [
          { kind: 'M', to: { x: source.point.x, y: 0 } },
          { kind: 'L', to: target.point },
        ],
      },
      'test',
    );
    for (const type of ['test:missing', 'test:boom', 'test:empty', 'test:lines', 'test:left', 'test:beside'] as const) {
      const { store, line } = scene((records, ids) => {
        (records[ids.line] as { route: unknown }).route = { type };
      });
      expect(r9(store.query((view) => routeConnector(view, ctx, line))()?.commands)).toEqual([
        { kind: 'M', to: { x: 100, y: 50 } },
        { kind: 'L', to: { x: 300, y: 50 } },
      ]);
    }
    // a built-in type another source already holds keeps that source's router
    const routers = createRegistry<string, Router>('routers');
    routers.register('straight', zigzag, 'test');
    registerBuiltinRouters(routers);
    expect(routers.get('straight')).toBe(zigzag);
    // and a fresh registry gets straight from core
    const fresh = createRegistry<string, Router>('routers');
    registerBuiltinRouters(fresh);
    expect([fresh.get('straight'), fresh.source('straight')]).toEqual([straightRouter, 'core']);
  });
});

describe('connector ends (FR-CON-001, FR-ANC-001, FR-ANC-002)', () => {
  it('FR-CON-001: bound ends resolve through their anchors and outlines; free ends are their points', () => {
    const ctx = context();
    const plain = scene();
    const routed = plain.store.query((view) => routeConnector(view, ctx, plain.line))();
    expect(r9(routed?.source)).toEqual({ point: { x: 100, y: 50 }, dir: { x: 1, y: 0 } });
    expect(r9(routed?.target)).toEqual({ point: { x: 300, y: 50 } });
    // a named anchor
    const named = scene((records) => {
      const binding = Object.values(records).find((r) => (r as { type?: unknown }).type === 'binding') as { anchor: unknown };
      binding.anchor = { kind: 'named', name: 's' };
    });
    expect(r9(named.store.query((view) => routeConnector(view, ctx, named.line))()?.source)).toEqual({ point: { x: 50, y: 100 }, dir: { x: 0, y: 1 } });
    // a registered definition's outline: toward the upper right, on the ellipse, not the box corner
    const oval = scene((records, ids) => {
      (records[ids.rect] as { defId: string }).defId = 'test:ellipse';
      (records[ids.line] as { freeTarget: unknown }).freeTarget = { x: 550, y: -450 };
    });
    const onOval = oval.store.query((view) => routeConnector(view, ctx, oval.line))()?.source.point;
    expect(onOval?.x).toBeCloseTo(50 + 50 * Math.SQRT1_2, 6);
    expect(onOval?.y).toBeCloseTo(50 - 50 * Math.SQRT1_2, 6);
    // a bound element that is not a shape is its box
    const text = scene((records, ids) => {
      (records[ids.rect] as { kind: string }).kind = 'text';
      (records[ids.rect] as { text: unknown }).text = { type: 'doc', content: [] };
      (records[ids.rect] as { defId: string }).defId = 'test:ellipse';
      (records[ids.line] as { freeTarget: unknown }).freeTarget = { x: 550, y: -450 };
    });
    expect(r9(text.store.query((view) => routeConnector(view, ctx, text.line))()?.source.point)).toEqual({ x: 100, y: 0 });
  });

  it('FR-CON-001: floating ends aim at the nearest waypoint, then at the other end', () => {
    const ctx = context();
    const { store, line } = scene((records, ids) => {
      (records[ids.line] as { route: unknown }).route = { type: 'straight', waypoints: [{ x: 50, y: -200 }] };
    });
    expect(r9(store.query((view) => routeConnector(view, ctx, line))()?.source.point)).toEqual({ x: 50, y: 0 });
    // two bound ends aim at each other's centres: on the diagonal, corner to corner
    const b = documentBuilder({ seed: 5171 });
    const screenId = b.screen();
    const left = b.rect(screenId, { x: 0, y: 0, w: 100, h: 100 });
    const right = b.rect(screenId, { x: 300, y: 300, w: 100, h: 100, rot: 90 });
    const both = b.connect(left, right);
    const two = createCore(b.build()).store.query((view) => routeConnector(view, ctx, both))();
    expect(r9(two?.source.point)).toEqual({ x: 100, y: 100 });
    expect(two?.target.point.x).toBeCloseTo(300, 9);
    expect(two?.target.point.y).toBeCloseTo(300, 9);
    expect(lineTo(two?.commands[1])).toEqual(two?.target.point);
    // with waypoints the source aims at the first, the target at the last: straight up out of each top
    const via = createCore({
      ...b.build(),
      records: {
        ...b.build().records,
        [both]: {
          ...(b.build().records[both] as object),
          route: {
            type: 'straight',
            waypoints: [
              { x: 50, y: -500 },
              { x: 200, y: -500 },
              { x: 350, y: 0 },
            ],
          },
        },
      },
    } as DocumentFile).store.query((view) => routeConnector(view, ctx, both))();
    expect(r9(via?.target.point)).toEqual({ x: 350, y: 300 });
    expect(r9(via?.source.point)).toEqual({ x: 50, y: 0 });
  });

  it('FR-CON-001: moving a bound element re-routes its connectors', () => {
    const ctx = context();
    const { store, rect, line } = scene();
    const routed = store.query((view) => routeConnector(view, ctx, line));
    expect(r9(routed()?.source.point)).toEqual({ x: 100, y: 50 });
    // 100 px down: the ray to (300, 50) leaves the right edge at y 130
    store.transact('move', (tx) => tx.patch(rect, { transform: { x: 0, y: 100, w: 100, h: 100 } }));
    expect(r9(routed()?.source.point)).toEqual({ x: 100, y: 130 });
  });

  it('FR-CON-001: an end that can be placed neither from a binding nor from a point leaves no route', () => {
    const ctx = context();
    const route = (edit: Parameters<typeof scene>[0]) => {
      const s = scene(edit);
      return s.store.query((view) => routeConnector(view, ctx, s.line))();
    };
    // no free target
    expect(
      route((records, ids) => {
        delete (records[ids.line] as { freeTarget?: unknown }).freeTarget;
      }),
    ).toBeUndefined();
    // bound to an element without a box
    expect(
      route((records, ids) => {
        delete (records[ids.rect] as { transform?: unknown }).transform;
      }),
    ).toBeUndefined();
    // a connector another connector is bound to reads only its own bindings: its free ends stay free
    const b = documentBuilder({ seed: 5172 });
    const screenId = b.screen();
    const rect = b.rect(screenId, { x: 0, y: 200, w: 100, h: 100 });
    const free = b.connect({ x: 0, y: 0 }, { x: 10, y: 0 });
    b.connect(free, rect);
    expect(r9(createCore(b.build()).store.query((view) => routeConnector(view, ctx, free))()?.source)).toEqual({ point: { x: 0, y: 0 } });
    // no such connector
    expect(scene().store.query((view) => routeConnector(view, ctx, 'nope' as RecordId))()).toBeUndefined();
  });
});
