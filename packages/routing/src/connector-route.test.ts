import { createCore, createRegistry, type ShapeDef } from '@fluxion/core';
import type { PathCommand } from '@fluxion/geometry';
import type { DocumentFile, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { resolveAnchor } from './anchor.js';
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
    // starts at the source but stops short of the target
    ctx.routers.register(
      'test:short',
      {
        route: ({ source, target }) => [
          { kind: 'M', to: source.point },
          { kind: 'L', to: { x: target.point.x - 10, y: target.point.y } },
        ],
      },
      'test',
    );
    for (const type of ['test:missing', 'test:boom', 'test:empty', 'test:lines', 'test:left', 'test:beside', 'test:short'] as const) {
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
    expect(r9(routed?.source)).toEqual({ point: { x: 100, y: 50 }, dir: { x: 1, y: 0 }, normal: { x: 1, y: 0 } });
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

describe('orthogonal routes from floating ends (FR-RTE-001, FR-ANC-007, M16.34)', () => {
  /** A 160 x 80 box above-left of a wide hub, joined orthogonally by floating ends: the pull from A to the hub is more across than down, but
   * the ray from A's centre leaves by its bottom side, and the one from the hub's centre by its top. */
  function spread() {
    const b = documentBuilder({ seed: 5173 });
    const screenId = b.screen();
    const a = b.rect(screenId, { x: 160, y: 120, w: 160, h: 80 });
    const hub = b.rect(screenId, { x: 520, y: 400, w: 480, h: 100 });
    const line = b.connect(a, hub, { route: 'orthogonal' });
    return { store: createCore(b.build()).store, line };
  }
  const points = (commands: readonly PathCommand[] | undefined) => (commands ?? []).flatMap((c) => (c.kind === 'Z' ? [] : [c.to]));

  it('FR-RTE-001: the first segment leaves its side along the side normal and the last enters along the target side normal', () => {
    const { store, line } = spread();
    const routed = r9(store.query((view) => routeConnector(view, context(), line))());
    // A's centre (240, 160) toward the hub's (760, 450): the ray leaves A by its bottom side, the hub's toward A by its top side
    expect(routed?.source.point.y).toBe(200);
    expect(routed?.source.normal).toEqual({ x: 0, y: 1 });
    expect(routed?.target.point.y).toBe(400);
    expect(routed?.target.normal).toEqual({ x: 0, y: -1 });
    const p = points(routed?.commands);
    const [first, second, last, beforeLast] = [p[0], p[1], p.at(-1), p.at(-2)];
    // down out of A's bottom side (x kept, y grows), and down into the hub's top side
    expect([second?.x, (second?.y ?? 0) > (first?.y ?? 0)]).toEqual([first?.x, true]);
    expect([beforeLast?.x, (beforeLast?.y ?? 0) < (last?.y ?? 0)]).toEqual([last?.x, true]);
  });

  it('FR-ANC-007: a floating end on a side carries that side normal, turned with the element; other anchors carry none', () => {
    const target = { transform: { x: 0, y: 0, w: 160, h: 80 }, anchors: [] };
    // toward (300, 120) from the centre (80, 40): more across (220) than down (80), yet the ray leaves by the right side, and toward
    // (200, 160) by the bottom (dx 120 / 80 < dy 120 / 40)
    expect(r9(resolveAnchor(target, { kind: 'floating' }, { x: 300, y: 120 }).normal)).toEqual({ x: 1, y: 0 });
    expect(r9(resolveAnchor(target, { kind: 'floating' }, { x: 200, y: 160 }).normal)).toEqual({ x: 0, y: 1 });
    // a quarter turn maps the box's bottom side to screen left
    const turned = { transform: { x: 0, y: 0, w: 160, h: 80, rot: 90 }, anchors: [] };
    const toward = resolveAnchor(turned, { kind: 'floating' }, { x: -400, y: 40 });
    expect(r9(toward.normal)).toEqual({ x: -1, y: 0 });
    // the other end on the centre: no direction, no normal; a named anchor carries none
    expect(resolveAnchor(target, { kind: 'floating' }, { x: 80, y: 40 }).normal).toBeUndefined();
    expect(resolveAnchor(target, { kind: 'named', name: 's' }, { x: 300, y: 120 }).normal).toBeUndefined();
  });
});
