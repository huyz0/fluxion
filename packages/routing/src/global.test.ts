// FR-RTE-003: the global pass routes a screen's orthogonal connectors as one batch, around the shapes, and nudges side-by-side segments
// apart by the spacing; its input is plain data built from the store.
import { createCore, createRegistry, type ShapeDef, writable } from '@fluxion/core';
import type { Box, PathCommand, Vec2 } from '@fluxion/geometry';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { registerBuiltinRouters } from './builtins.js';
import { type RouteContext, routeConnector } from './connector-route.js';
import { type GlobalRouteInput, globalRouteInput, globalRoutes } from './global.js';
import type { Router } from './router.js';

const points = (commands: readonly PathCommand[]): Vec2[] => commands.map((c) => (c as { to: Vec2 }).to);

/** Whether the axis-aligned segment a→b passes through the inside of `box`. */
function crosses(a: Vec2, b: Vec2, box: Box): boolean {
  const [x0, x1, y0, y1] = [Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(a.y, b.y), Math.max(a.y, b.y)];
  return x1 > box.x && x0 < box.x + box.w && y1 > box.y && y0 < box.y + box.h;
}

const east = (x: number, y: number) => ({ point: { x, y }, dir: { x: 1, y: 0 } });
const west = (x: number, y: number) => ({ point: { x, y }, dir: { x: -1, y: 0 } });

describe('the global routing pass (FR-RTE-003)', () => {
  it('FR-RTE-003: a floating end leaves and enters along its side normal, not along its pull toward the other end (M16.34)', () => {
    // A (160..320, 120..200) leaves by its bottom side toward the hub's top side, though its pull (dir) is more across than down
    const pull = { x: 0.873, y: 0.487 };
    const input: GlobalRouteInput = {
      obstacles: [
        { id: 'a', box: { x: 160, y: 120, w: 160, h: 80 } },
        { id: 'hub', box: { x: 520, y: 400, w: 480, h: 100 } },
      ],
      connectors: [
        {
          id: 'c',
          source: { point: { x: 311.7, y: 200 }, dir: pull, normal: { x: 0, y: 1 } },
          target: { point: { x: 588.3, y: 400 }, dir: { x: -pull.x, y: -pull.y }, normal: { x: 0, y: -1 } },
        },
      ],
    };
    const path = points(globalRoutes(input)[0]?.commands ?? []);
    const [first, second, beforeLast, last] = [0, 1, -2, -1].map((k) => path.at(k) as Vec2) as [Vec2, Vec2, Vec2, Vec2];
    expect([second.x, second.y > first.y]).toEqual([first.x, true]);
    expect([beforeLast.x, beforeLast.y < last.y]).toEqual([last.x, true]);
  });

  it('FR-RTE-003: a route goes around a shape in its way, from end to end', () => {
    const wall: Box = { x: 150, y: 0, w: 60, h: 200 };
    const input: GlobalRouteInput = {
      obstacles: [
        { id: 'a', box: { x: 0, y: 75, w: 50, h: 50 } },
        { id: 'wall', box: wall },
        { id: 'b', box: { x: 300, y: 75, w: 50, h: 50 } },
      ],
      connectors: [{ id: 'c', source: east(50, 100), target: west(300, 100) }],
    };
    const [route] = globalRoutes(input);
    const path = points(route?.commands ?? []);
    expect(path[0]).toEqual({ x: 50, y: 100 });
    expect(path.at(-1)).toEqual({ x: 300, y: 100 });
    expect(path.slice(1).some((p, k) => crosses(path[k] as Vec2, p, wall))).toBe(false);
    expect(path.slice(1).every((p, k) => p.x === (path[k] as Vec2).x || p.y === (path[k] as Vec2).y)).toBe(true);
  });

  it('FR-RTE-003: two connectors through one channel are nudged at least the spacing apart, the same way every time', () => {
    const input: GlobalRouteInput = {
      obstacles: [
        { id: 'top', box: { x: 100, y: -200, w: 100, h: 190 } },
        { id: 'bottom', box: { x: 100, y: 10, w: 100, h: 190 } },
      ],
      connectors: [
        { id: 'c1', source: east(0, -30), target: west(300, -30) },
        { id: 'c2', source: east(0, 30), target: west(300, 30) },
      ],
      margin: 2,
      spacing: 6,
    };
    const routes = globalRoutes(input);
    expect(globalRoutes(input)).toEqual(routes);
    // where both run horizontally through the gap between x 100 and 200, their y differ by at least the spacing
    const inGap = (r: (typeof routes)[number]) =>
      points(r.commands).flatMap((p, k, all) =>
        k > 0 && p.y === (all[k - 1] as Vec2).y && Math.min(p.x, (all[k - 1] as Vec2).x) <= 100 && Math.max(p.x, (all[k - 1] as Vec2).x) >= 200 ? [p.y] : [],
      );
    const [y1, y2] = [inGap(routes[0] as never)[0], inGap(routes[1] as never)[0]];
    expect(y1).toBeDefined();
    expect(y2).toBeDefined();
    expect(Math.abs((y1 as number) - (y2 as number))).toBeGreaterThanOrEqual(6);
  });

  it('FR-RTE-003: routes nudged apart keep the margin from the shapes they pass, as the search did', () => {
    const wall: Box = { x: 150, y: 0, w: 60, h: 200 };
    const margin = 8;
    const input: GlobalRouteInput = {
      obstacles: [
        { id: 'a', box: { x: 0, y: 0, w: 50, h: 200 } },
        { id: 'wall', box: wall },
        { id: 'b', box: { x: 300, y: 0, w: 50, h: 200 } },
      ],
      // both go over the wall, one beside the other: the nudge spreads them, but not into the margin
      connectors: [
        { id: 'c1', source: east(50, 20), target: west(300, 20) },
        { id: 'c2', source: east(50, 30), target: west(300, 30) },
      ],
      margin,
      spacing: 6,
    };
    const routes = globalRoutes(input);
    expect(routes).toHaveLength(2);
    const clear: Box = { x: wall.x - margin + 1e-6, y: wall.y - margin + 1e-6, w: wall.w + 2 * margin - 2e-6, h: wall.h + 2 * margin - 2e-6 };
    for (const route of routes) {
      const path = points(route.commands);
      expect(path.slice(1).some((p, k) => crosses(path[k] as Vec2, p, clear))).toBe(false);
    }
  });

  it('FR-RTE-003: the input names the solid elements and the orthogonal connectors without waypoints, with their resolved ends', () => {
    const b = documentBuilder({ seed: 7 });
    const screen = b.screen();
    const a = b.rect(screen, { x: 0, y: 0, w: 100, h: 100 });
    const c = b.rect(screen, { x: 400, y: 0, w: 100, h: 100 });
    const ortho = b.connect(a, c, { route: 'orthogonal' });
    b.connect(a, c);
    const pinned = b.connect(a, c, { route: 'orthogonal' });
    const { store } = createCore(b.build());
    store.transact('pin', (tx) => tx.patch(pinned, { route: { type: 'orthogonal', waypoints: [{ x: 250, y: 300 }] } }));
    const routers = createRegistry<string, Router>('routers');
    registerBuiltinRouters(routers);
    const ctx: RouteContext = { shapeDefs: createRegistry<string, ShapeDef>('shapeDefs'), routers };
    const input = store.query((v) => globalRouteInput(v, ctx, screen))();
    expect(input.obstacles.map((o) => o.id)).toEqual([a, c].sort());
    expect(input.obstacles.find((o) => o.id === a)?.box).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    expect(input.connectors.map((k) => k.id)).toEqual([ortho]);
    expect(input.connectors[0]?.source.point.x).toBeGreaterThanOrEqual(0);
    // plain data (a worker message): it survives a JSON round trip unchanged
    expect(JSON.parse(JSON.stringify(input))).toEqual(input);
  });

  it('FR-RTE-003: a refined route is drawn only while it runs between the current ends; one that no longer does falls back to the router', () => {
    const b = documentBuilder({ seed: 7 });
    const screen = b.screen();
    const a = b.rect(screen, { x: 0, y: 0, w: 100, h: 100 });
    const c = b.rect(screen, { x: 400, y: 0, w: 100, h: 100 });
    const link = b.connect(a, c, { route: 'orthogonal' });
    const { store } = createCore(b.build());
    const routers = createRegistry<string, Router>('routers');
    registerBuiltinRouters(routers);
    const base: RouteContext = { shapeDefs: createRegistry<string, ShapeDef>('shapeDefs'), routers };
    const cheap = routeConnector(store, base, link);
    if (cheap === undefined) throw new Error('unrouted');
    const { source, target } = cheap;
    const detour: PathCommand[] = [
      { kind: 'M', to: source.point },
      { kind: 'L', to: { x: source.point.x, y: -50 } },
      { kind: 'L', to: { x: target.point.x, y: -50 } },
      { kind: 'L', to: target.point },
    ];
    const refined = writable<ReadonlyMap<string, readonly PathCommand[]> | undefined>(new Map([[link, detour]]));
    expect(routeConnector(store, { ...base, refined: refined.get }, link)?.commands).toEqual(detour);
    // the same route once its source has moved off its first point: the router's route, not a detached one
    refined.set(new Map([[link, [{ kind: 'M', to: { x: 1, y: 1 } }, ...detour.slice(1)]]]));
    expect(routeConnector(store, { ...base, refined: refined.get }, link)?.commands).toEqual(cheap.commands);
  });
});
