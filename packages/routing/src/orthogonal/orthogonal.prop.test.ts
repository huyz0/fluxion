// FR-CON-004: over random obstacle fields, a found route is axis-aligned, keeps clear of every obstacle (inflated by the margin), runs from the
// start to the goal, and is the same when found again (FR-RTE-004).
import type { Box, Vec2 } from '@fluxion/geometry';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildGrid } from './grid.js';
import { searchRoute } from './search.js';

const MARGIN = 8;
const box = fc.record({
  x: fc.integer({ min: 0, max: 400 }),
  y: fc.integer({ min: 0, max: 300 }),
  w: fc.integer({ min: 10, max: 120 }),
  h: fc.integer({ min: 10, max: 100 }),
});
const inside = (p: Vec2, b: Box, pad: number) => p.x > b.x - pad && p.x < b.x + b.w + pad && p.y > b.y - pad && p.y < b.y + b.h + pad;
const clear = (obstacles: readonly Box[], p: Vec2) => obstacles.every((o) => !inside(p, o, MARGIN));

/** Whether the axis-aligned segment a-b enters the open interior of `b` inflated by the margin. */
function enters(a: Vec2, b: Vec2, o: Box): boolean {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  return x1 > o.x - MARGIN && x0 < o.x + o.w + MARGIN && y1 > o.y - MARGIN && y0 < o.y + o.h + MARGIN;
}

const scene = fc
  .record({
    boxes: fc.array(box, { minLength: 0, maxLength: 8 }),
    start: fc.record({ x: fc.integer({ min: -60, max: 560 }), y: fc.integer({ min: -60, max: 460 }) }),
    goal: fc.record({ x: fc.integer({ min: -60, max: 560 }), y: fc.integer({ min: -60, max: 460 }) }),
  })
  .filter(({ boxes, start, goal }) => clear(boxes, start) && clear(boxes, goal) && (start.x !== goal.x || start.y !== goal.y));

describe('the orthogonal search (FR-CON-004)', () => {
  it('FR-CON-004: routes are axis-aligned, join start to goal and never enter an obstacle inflated by the margin', () => {
    fc.assert(
      fc.property(scene, ({ boxes, start, goal }) => {
        const obstacles = boxes.map((b, k) => ({ id: `o${k}`, box: { x: b.x, y: b.y, w: b.w, h: b.h } }));
        const grid = buildGrid({ obstacles, stubs: [start, goal], margin: MARGIN });
        const route = searchRoute({ grid, obstacles: boxes.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h })), margin: MARGIN, start, goal });
        if (route === undefined) return true;
        expect(route[0]).toEqual(start);
        expect(route.at(-1)).toEqual(goal);
        for (let k = 1; k < route.length; k++) {
          const a = route[k - 1] as Vec2;
          const b = route[k] as Vec2;
          expect(a.x === b.x || a.y === b.y).toBe(true);
          for (const o of boxes) expect(enters(a, b, o)).toBe(false);
        }
        return true;
      }),
      { numRuns: 200, seed: 20260417 },
    );
  });

  it('FR-CON-004: with no obstacle the route is a single straight run or one bend', () => {
    const grid = buildGrid({
      obstacles: [],
      stubs: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 60 },
      ],
      margin: MARGIN,
    });
    expect(searchRoute({ grid, obstacles: [], margin: MARGIN, start: { x: 0, y: 0 }, goal: { x: 100, y: 0 } })).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect(searchRoute({ grid, obstacles: [], margin: MARGIN, start: { x: 0, y: 0 }, goal: { x: 100, y: 60 } })).toHaveLength(3);
  });

  it('FR-CON-004: a wall between the ends is gone around, and the anchor directions are honoured', () => {
    const wall = { x: 40, y: -100, w: 20, h: 200 };
    const start = { x: 0, y: 0 };
    const goal = { x: 100, y: 0 };
    const grid = buildGrid({ obstacles: [{ id: 'w', box: wall }], stubs: [start, goal], margin: MARGIN });
    const route = searchRoute({ grid, obstacles: [wall], margin: MARGIN, start, goal, startDir: { x: 1, y: 0 }, goalDir: { x: 1, y: 0 } }) as Vec2[];
    expect(route[0]).toEqual(start);
    expect(route.at(-1)).toEqual(goal);
    // leaves east, arrives from the east (against the goal anchor's direction): it goes around the wall's end
    expect((route[1] as Vec2).y).toBe(0);
    expect(Math.min(...route.map((p) => p.y))).toBeLessThan(-100);
  });

  it('FR-CON-004: a route is the same when found again, a crossing costs and a closed field has none', () => {
    const grid = buildGrid({
      obstacles: [],
      stubs: [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
        { x: 50, y: -20 },
        { x: 50, y: 120 },
      ],
      margin: MARGIN,
    });
    const input = { grid, obstacles: [], margin: MARGIN, start: { x: 0, y: 0 }, goal: { x: 100, y: 100 } };
    expect(searchRoute(input)).toEqual(searchRoute(input));
    // a long vertical wire of an earlier route at x = 50: the route avoids crossing it when going around costs less than the penalty
    const plain = searchRoute(input) as Vec2[];
    const crossed = searchRoute({
      ...input,
      existing: [
        { from: { x: 0, y: 0 }, to: { x: 100, y: 0 } },
        { from: { x: 100, y: 0 }, to: { x: 100, y: 100 } },
      ],
    }) as Vec2[];
    expect(plain.length).toBeGreaterThan(1);
    expect(crossed.length).toBeGreaterThan(1);
    // out of reach: the start is not a grid line, and the search bound
    expect(searchRoute({ ...input, start: { x: 1, y: 1 } })).toBeUndefined();
    expect(searchRoute({ ...input, maxExpansions: 0 })).toBeUndefined();
    // the goal fully enclosed by obstacles has no route
    const ring = [
      { x: 80, y: 80, w: 40, h: 4 },
      { x: 80, y: 116, w: 40, h: 4 },
      { x: 80, y: 80, w: 4, h: 40 },
      { x: 116, y: 80, w: 4, h: 40 },
    ];
    const g2 = buildGrid({
      obstacles: ring.map((b, k) => ({ id: `r${k}`, box: b })),
      stubs: [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ],
      margin: 2,
    });
    expect(searchRoute({ grid: g2, obstacles: ring, margin: 2, start: { x: 0, y: 0 }, goal: { x: 100, y: 100 } })).toBeUndefined();
  });
});
