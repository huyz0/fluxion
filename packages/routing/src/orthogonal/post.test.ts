// FR-RTE-003: simplify drops collinear points and merges small jogs without moving the ends or shortening the stubs; nudge spreads routes
// that run side by side to the spacing, never into an obstacle, and gives the same output every time.
import type { Box, Vec2 } from '@fluxion/geometry';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { nudge } from './nudge.js';
import { simplify } from './simplify.js';

const p = (x: number, y: number): Vec2 => ({ x, y });

describe('simplify (FR-RTE-003)', () => {
  it('FR-RTE-003: drops repeated and collinear points', () => {
    expect(simplify([p(0, 0), p(0, 0), p(10, 0), p(20, 0), p(20, 30)])).toEqual([p(0, 0), p(20, 0), p(20, 30)]);
  });

  it('FR-RTE-003: merges a jog under 4 px by moving the segment before it onto the one after', () => {
    const out = simplify([p(0, 0), p(20, 0), p(20, 40), p(60, 40), p(60, 42), p(100, 42), p(100, 90)], { minJog: 4 });
    expect(out).toEqual([p(0, 0), p(20, 0), p(20, 42), p(100, 42), p(100, 90)]);
  });

  it('FR-RTE-003: keeps a jog of 4 px or more', () => {
    const route = [p(0, 0), p(20, 0), p(20, 40), p(60, 40), p(60, 44), p(100, 44), p(100, 90)];
    expect(simplify(route)).toEqual(route);
  });

  it('FR-RTE-003: never moves the two ends nor shortens a stub below minStub', () => {
    const route = [p(0, 0), p(14, 0), p(14, 2), p(60, 2), p(60, 50)];
    const out = simplify(route, { minJog: 4, minStub: 12 });
    expect(out[0]).toEqual(p(0, 0));
    expect(out[out.length - 1]).toEqual(p(60, 50));
    expect(Math.abs((out[1] as Vec2).x - (out[0] as Vec2).x) + Math.abs((out[1] as Vec2).y - (out[0] as Vec2).y)).toBeGreaterThanOrEqual(12);
  });
});

describe('nudge (FR-RTE-003)', () => {
  const a = [p(0, 0), p(20, 0), p(20, 100), p(180, 100), p(180, 200), p(200, 200)];
  const b = [p(0, 300), p(30, 300), p(30, 100), p(170, 100), p(170, 200), p(200, 200)];

  it('FR-RTE-003: spreads two routes that share a channel to the spacing, around their mean', () => {
    const [x, y] = nudge([{ points: a }, { points: b }], 10);
    expect([(x as Vec2[])[2]?.y, (y as Vec2[])[2]?.y]).toEqual([95, 105]);
    expect([(x as Vec2[])[3]?.y, (y as Vec2[])[3]?.y]).toEqual([95, 105]);
  });

  it('FR-RTE-003: leaves the ends and the end segments where they were', () => {
    const [x] = nudge([{ points: a }, { points: b }], 10);
    expect((x as Vec2[])[0]).toEqual(a[0]);
    expect((x as Vec2[])[1]).toEqual(a[1]);
    expect((x as Vec2[]).at(-1)).toEqual(a.at(-1));
  });

  it('FR-RTE-003: leaves a route alone when the push would send it into an obstacle', () => {
    const wall: Box = { x: 100, y: 90, w: 10, h: 9 };
    const out = nudge([{ points: a, avoid: [wall] }, { points: b }], 10);
    expect(out[0]).toEqual(a);
    expect(Math.abs(((out[1] as Vec2[])[2] as Vec2).y - 100)).toBeGreaterThanOrEqual(10);
  });

  it('FR-RTE-003: the same input gives the same output', () => {
    expect(nudge([{ points: a }, { points: b }], 10)).toEqual(nudge([{ points: a }, { points: b }], 10));
  });
});

const line = fc.array(fc.tuple(fc.integer({ min: 1, max: 20 }), fc.integer({ min: 1, max: 20 })), { minLength: 2, maxLength: 4 });
/** A staircase route from the origin: alternating horizontal and vertical legs, ending with a leg that is a stub. */
const route = fc.tuple(fc.integer({ min: 0, max: 8 }), line).map(([row, steps]) => {
  const pts: Vec2[] = [p(0, row * 30)];
  for (const [dx, dy] of steps)
    pts.push(p((pts.at(-1) as Vec2).x + dx * 20, (pts.at(-1) as Vec2).y), p((pts.at(-1) as Vec2).x + dx * 20, (pts.at(-1) as Vec2).y + dy * 10));
  return pts;
});

type Run = { readonly horizontal: boolean; readonly line: number; readonly lo: number; readonly hi: number };

/** The inner segments of a route (all but the end segments) as runs. */
function runs(r: readonly Vec2[]): Run[] {
  const out: Run[] = [];
  for (let k = 1; k + 2 < r.length; k++) {
    const [a, b] = [r[k] as Vec2, r[k + 1] as Vec2];
    const horizontal = a.y === b.y;
    out.push({
      horizontal,
      line: horizontal ? a.y : a.x,
      lo: horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y),
      hi: horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y),
    });
  }
  return out;
}

const gapOf = (a: Run, b: Run): number =>
  a.horizontal === b.horizontal && Math.min(a.hi, b.hi) > Math.max(a.lo, b.lo) ? Math.abs(a.line - b.line) : Number.POSITIVE_INFINITY;

/** The smallest gap between parallel segments of different routes that overlap along their run. */
function narrowest(routes: readonly Vec2[][]): number {
  const all = routes.map(runs);
  let least = Number.POSITIVE_INFINITY;
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      for (const a of all[i] as Run[]) for (const b of all[j] as Run[]) least = Math.min(least, gapOf(a, b));
    }
  }
  return least;
}

describe('nudge, random routes (FR-RTE-003)', () => {
  it('FR-RTE-003: after nudging, overlapping parallel segments of different routes are at least the spacing apart ', () => {
    fc.assert(
      fc.property(fc.array(route, { minLength: 2, maxLength: 3 }), (routes) => {
        const out = nudge(
          routes.map((points) => ({ points })),
          6,
        );
        expect(out).toEqual(
          nudge(
            routes.map((points) => ({ points })),
            6,
          ),
        );
        out.forEach((r, i) => {
          expect(r[0]).toEqual((routes[i] as Vec2[])[0]);
          expect(r.at(-1)).toEqual((routes[i] as Vec2[]).at(-1));
          for (let k = 0; k + 1 < r.length; k++) expect((r[k] as Vec2).x === (r[k + 1] as Vec2).x || (r[k] as Vec2).y === (r[k + 1] as Vec2).y).toBe(true);
        });
        expect(narrowest(out)).toBeGreaterThanOrEqual(6 - 1e-9);
      }),
      { seed: 20260417, numRuns: 200 },
    );
  });
});
