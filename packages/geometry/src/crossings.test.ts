import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { polylineCrossings } from './crossings.js';
import { intersectSegments } from './intersections.js';
import type { Vec2 } from './vec2.js';

const line = (id: string, ...pts: [number, number][]) => ({ id, points: pts.map(([x, y]) => ({ x, y })) });

type Line = ReturnType<typeof line>;
const pairs = (pts: readonly Vec2[]): [Vec2, Vec2][] => pts.slice(1).map((q, i): [Vec2, Vec2] => [pts[i] as Vec2, q]);
const touches = (seg: [Vec2, Vec2], at: Vec2): boolean => seg.some((e) => e.x === at.x && e.y === at.y);

const properCrossing = (s: [Vec2, Vec2], t: [Vec2, Vec2]): boolean => {
  const at = intersectSegments(s, t);
  return at !== null && !touches(s, at) && !touches(t, at);
};

/** Crossings between two lines counted by testing every pair of their segments. */
const between = (u: Line, w: Line): number => pairs(u.points).flatMap((s) => pairs(w.points).filter((t) => properCrossing(s, t))).length;

/** Crossings counted by testing every pair of lines. */
const bruteForce = (lines: readonly Line[]): number => lines.flatMap((u, i) => lines.slice(i + 1).map((w) => between(u, w))).reduce((n, c) => n + c, 0);

describe('polylineCrossings (FR-CON-008)', () => {
  it('FR-CON-008: finds the crossing of a horizontal and a vertical line', () => {
    expect(polylineCrossings([line('h', [0, 5], [10, 5]), line('v', [4, 0], [4, 10])])).toEqual([
      { a: 'h', b: 'v', aSegment: 0, bSegment: 0, at: { x: 4, y: 5 } },
    ]);
  });

  it('FR-CON-008: lists a pair by id order whatever the input order', () => {
    const lines = [line('v', [4, 0], [4, 10]), line('h', [0, 5], [10, 5])];
    expect(polylineCrossings(lines).map((c) => [c.a, c.b])).toEqual([['h', 'v']]);
    expect(polylineCrossings([...lines].reverse())).toEqual(polylineCrossings(lines));
  });

  it('FR-CON-008: a touch at an end, a shared corner and a line with itself are not crossings', () => {
    expect(polylineCrossings([line('h', [0, 5], [4, 5]), line('v', [4, 0], [4, 10])])).toEqual([]);
    expect(polylineCrossings([line('a', [0, 0], [5, 5]), line('b', [5, 5], [10, 0])])).toEqual([]);
    expect(polylineCrossings([line('z', [0, 0], [10, 0], [10, 10], [5, 10], [5, -5])])).toEqual([]);
  });

  it('FR-CON-008: reports the segment of each line a bend crossing lies on', () => {
    const [c] = polylineCrossings([line('a', [0, 0], [0, 10], [20, 10]), line('b', [10, 5], [10, 15])]);
    expect(c).toMatchObject({ aSegment: 1, bSegment: 0, at: { x: 10, y: 10 } });
  });

  it('FR-CON-008: the sweep finds what a pairwise test finds', () => {
    const pt = fc.tuple(fc.integer({ min: 0, max: 40 }), fc.integer({ min: 0, max: 40 }));
    const poly = fc.array(pt, { minLength: 2, maxLength: 5 });
    fc.assert(
      fc.property(fc.array(poly, { minLength: 2, maxLength: 5 }), (polys) => {
        const lines = polys.map((p, i) => line(`l${i}`, ...p));
        expect(polylineCrossings(lines).length).toBe(bruteForce(lines));
      }),
      { numRuns: 300, seed: 20260417 },
    );
  });
});
