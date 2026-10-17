// NFR-PERF-005: routing 200 orthogonal connectors among 200 shapes (100 joins to a neighbour, 50 to the shape below, 50 across
// the canvas): one grid for the batch, an A* per connector that pays to cross the routes already placed, then simplify and one
// nudge over the batch. The shared bench leg of the M16 gate holds the p99 of `route-200` to ROUTE_200_ORTHO_MS.
import type { Box, Vec2 } from '@fluxion/geometry';
import { describe, test } from 'vitest';
import { buildGrid } from '../src/orthogonal/grid.js';
import { nudge } from '../src/orthogonal/nudge.js';
import { type RouteSegment, searchRoute } from '../src/orthogonal/search.js';
import { simplify } from '../src/orthogonal/simplify.js';

const COLUMNS = 20;
const SHAPES = 200;
const MARGIN = 8;
const STUB = 20;

const boxes: Box[] = Array.from({ length: SHAPES }, (_, k) => ({ x: (k % COLUMNS) * 140, y: Math.floor(k / COLUMNS) * 100, w: 80, h: 40 }));
/**
 * The joins of a diagram: shape `2k` to its right neighbour (100 joins) and shape `3k` to the shape
 * below it (50), and 50 long ones, shape `k` to `(k * 7 + 3) % SHAPES`, which cross the canvas and detour among the rest.
 */
const pairs: (readonly [number, number])[] = [
  ...Array.from({ length: 100 }, (_, k): readonly [number, number] => [k * 2, k * 2 + 1]),
  ...Array.from({ length: 50 }, (_, k): readonly [number, number] => [k * 3, k * 3 + COLUMNS]),
  ...Array.from({ length: 50 }, (_, k): readonly [number, number] => [k * 4, (k * 4 * 7 + 3) % SHAPES]),
].filter(([a, b]) => a !== b && b < SHAPES);

const east = (b: Box): Vec2 => ({ x: b.x + b.w, y: b.y + b.h / 2 });
const west = (b: Box): Vec2 => ({ x: b.x, y: b.y + b.h / 2 });
const stubOf = (p: Vec2, dx: number): Vec2 => ({ x: p.x + dx * STUB, y: p.y });

/** The 200 routes as a batch: what a full global pass computes. */
function routeAll(): number {
  const ends = pairs.map(([a, b]) => ({ a, b, from: stubOf(east(boxes[a] as Box), 1), to: stubOf(west(boxes[b] as Box), -1) }));
  const grid = buildGrid({
    obstacles: boxes.map((box, k) => ({ id: String(k), box })),
    stubs: ends.flatMap((e) => [e.from, e.to]),
    margin: MARGIN,
  });
  const placed: RouteSegment[] = [];
  const routes: Vec2[][] = [];
  for (const e of ends) {
    const path = searchRoute({
      grid,
      obstacles: boxes.filter((_, k) => k !== e.a && k !== e.b),
      margin: MARGIN,
      start: e.from,
      goal: e.to,
      existing: placed,
    });
    const points = simplify(path ?? [e.from, e.to]);
    routes.push(points);
    for (let i = 1; i < points.length; i++) placed.push({ from: points[i - 1] as Vec2, to: points[i] as Vec2 });
  }
  return nudge(
    routes.map((points) => ({ points })),
    6,
  ).length;
}

describe('route 200 orthogonal connectors (NFR-PERF-005)', () => {
  test('NFR-PERF-005: route-200', async ({ bench }) => {
    if (routeAll() !== pairs.length) throw new Error('the bench batch lost a route');
    await bench('route-200', { async: false }, () => {
      routeAll();
    }).run({ time: 3_000, warmupTime: 500 });
  });
});
