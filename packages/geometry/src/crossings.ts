// Crossings between polylines by a sweep along x (architecture 05 §8, FR-CON-008): segments enter
// the active set at their left end and leave past their right end, and each is tested only against
// the active segments of other lines. A touch at an end of either segment is not a crossing.
import { intersectSegments } from './intersections.js';
import type { Vec2 } from './vec2.js';

/**
 * A polyline to find crossings of.
 *
 * @public
 */
export type Polyline = {
  /** Identifies the line in the crossings. */
  readonly id: string;
  /** The points, in order; at least two for the line to have a segment. */
  readonly points: readonly Vec2[];
};

/**
 * Where line `a` crosses line `b` (`a` sorts before `b` by id).
 *
 * @public
 */
export type Crossing = {
  /** Id of the first line. */
  readonly a: string;
  /** Id of the second line. */
  readonly b: string;
  /** Index of the segment of `a` (from point `aSegment` to the next). */
  readonly aSegment: number;
  /** Index of the segment of `b`. */
  readonly bSegment: number;
  /** The crossing point. */
  readonly at: Vec2;
};

type Seg = { readonly id: string; readonly index: number; readonly p: Vec2; readonly q: Vec2; readonly x0: number; readonly x1: number };

const sameAs = (u: Vec2, v: Vec2): boolean => Math.abs(u.x - v.x) < 1e-9 && Math.abs(u.y - v.y) < 1e-9;
const isEnd = (s: Seg, at: Vec2): boolean => sameAs(s.p, at) || sameAs(s.q, at);

const compareStr = (u: string, v: string): number => (u < v ? -1 : u > v ? 1 : 0);

function segments(lines: readonly Polyline[]): Seg[] {
  const out: Seg[] = [];
  for (const line of lines)
    for (let index = 0; index + 1 < line.points.length; index++) {
      const [p, q] = [line.points[index] as Vec2, line.points[index + 1] as Vec2];
      out.push({ id: line.id, index, p, q, x0: Math.min(p.x, q.x), x1: Math.max(p.x, q.x) });
    }
  return out.sort((s, t) => s.x0 - t.x0 || compareStr(s.id, t.id) || s.index - t.index);
}

function cross(s: Seg, t: Seg): Crossing | undefined {
  if (s.id === t.id) return undefined;
  const at = intersectSegments([s.p, s.q], [t.p, t.q]);
  if (at === null || isEnd(s, at) || isEnd(t, at)) return undefined;
  const [first, second] = s.id < t.id ? [s, t] : [t, s];
  return { a: first.id, b: second.id, aSegment: first.index, bSegment: second.index, at };
}

/**
 * Every proper crossing between segments of two different lines, ordered by line ids, then segment
 * indices. Touches at a segment end, shared corners and collinear overlaps are not crossings.
 *
 * @public
 */
export function polylineCrossings(lines: readonly Polyline[]): Crossing[] {
  const found: Crossing[] = [];
  let active: Seg[] = [];
  for (const s of segments(lines)) {
    active = active.filter((t) => t.x1 >= s.x0);
    for (const t of active) {
      const c = cross(s, t);
      if (c !== undefined) found.push(c);
    }
    active.push(s);
  }
  return found.sort((u, v) => compareStr(u.a, v.a) || compareStr(u.b, v.b) || u.aSegment - v.aSegment || u.bSegment - v.bSegment);
}
