// Parallel connectors (ADR-0042, FR-CON-011): connectors between the same pair of elements would draw on top of each other. They are
// numbered in order within their pair and given offsets `spacing` apart, centred on zero. An orthogonal route moves its longest inner
// segment across its channel (a straight run gets a jog); a curved or straight one bows through a waypoint beside the chord. An offset does
// not depend on which way the connector runs: orthogonal offsets are shifts in +x or +y, and the bow is measured from the chord taken from
// its lesser end, so A to B and B to A with different offsets stay apart.
import type { Vec2 } from '@fluxion/geometry';

/**
 * A connector with the two elements it joins.
 *
 * @public
 */
export type ParallelEdge = {
  /** Identifies the connector in the result. */
  readonly id: string;
  /** One element. */
  readonly a: string;
  /** The other element. */
  readonly b: string;
};

/**
 * Offsets, px, for the connectors of every pair that has more than one, in the order given; absent for a lone connector. The pair is
 * unordered: A to B and B to A are parallel.
 *
 * @public
 */
export function parallelOffsets(edges: readonly ParallelEdge[], spacing: number): Map<string, number> {
  const groups = new Map<string, ParallelEdge[]>();
  for (const e of edges) {
    const name = e.a <= e.b ? `${e.a}\n${e.b}` : `${e.b}\n${e.a}`;
    groups.set(name, [...(groups.get(name) ?? []), e]);
  }
  const out = new Map<string, number>();
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    for (let i = 0; i < members.length; i++) {
      const e = members[i] as ParallelEdge;
      out.set(e.id, (i - (members.length - 1) / 2) * spacing);
    }
  }
  return out;
}

const length = (a: Vec2, b: Vec2): number => Math.abs(b.x - a.x) + Math.abs(b.y - a.y);

/** `points` with segment `k` (points k and k+1) moved by `offset` across its direction. */
function shift(points: readonly Vec2[], k: number, offset: number): Vec2[] {
  const horizontal = (points[k] as Vec2).y === (points[k + 1] as Vec2).y;
  return points.map((p, i) => (i === k || i === k + 1 ? (horizontal ? { x: p.x, y: p.y + offset } : { x: p.x + offset, y: p.y }) : p));
}

const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Whether the segment at `k` is the better pick than the one at `best`: longer, else the one whose middle is lesser (x, then y), so a tie does not depend on which way the route runs. */
function better(points: readonly Vec2[], k: number, best: number): boolean {
  const [a, b] = [length(points[k] as Vec2, points[k + 1] as Vec2), length(points[best] as Vec2, points[best + 1] as Vec2)];
  if (a !== b) return a > b;
  const [m, n] = [mid(points[k] as Vec2, points[k + 1] as Vec2), mid(points[best] as Vec2, points[best + 1] as Vec2)];
  return m.x < n.x || (m.x === n.x && m.y < n.y);
}

/** The index of the longest segment that is neither first nor last, or -1. */
function longestInner(points: readonly Vec2[]): number {
  let best = -1;
  for (let k = 1; k + 2 < points.length; k++) if (best < 0 || better(points, k, best)) best = k;
  return best;
}

/** Whether every segment of `after` runs the way it ran in `before`: no stub or neighbour was folded back by the shift. */
function unfolded(before: readonly Vec2[], after: readonly Vec2[]): boolean {
  return before.every((a, k) => {
    const [b, c, d] = [before[k + 1], after[k], after[k + 1]];
    return (
      b === undefined || c === undefined || d === undefined || (Math.sign(b.x - a.x) === Math.sign(d.x - c.x) && Math.sign(b.y - a.y) === Math.sign(d.y - c.y))
    );
  });
}

/**
 * An orthogonal route moved aside by `offset`: its longest inner segment shifts across its channel; a straight run (two points) gets a
 * jog of `stub` out of each end. A route with no inner segment and a bend (an L), or one whose neighbours are shorter than the shift, is returned unchanged; the caller checks the result against obstacles.
 *
 * @public
 */
export function fanOrthogonal(points: readonly Vec2[], offset: number, stub = 20): Vec2[] {
  if (offset === 0) return [...points];
  const inner = longestInner(points);
  if (inner >= 0) {
    const moved = shift(points, inner, offset);
    return unfolded(points, moved) ? moved : [...points];
  }
  const [a, b] = [points[0] as Vec2, points.at(-1) as Vec2];
  if (points.length !== 2 || (a.x !== b.x && a.y !== b.y)) return [...points];
  const d = { x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) };
  // across the run toward +x or +y, whichever way it runs
  const n = { x: Math.abs(d.y) * offset, y: Math.abs(d.x) * offset };
  if (length(a, b) <= 2 * stub) return [...points];
  const [s, t] = [
    { x: a.x + d.x * stub, y: a.y + d.y * stub },
    { x: b.x - d.x * stub, y: b.y - d.y * stub },
  ];
  return [a, s, { x: s.x + n.x, y: s.y + n.y }, { x: t.x + n.x, y: t.y + n.y }, t, b];
}

/**
 * The waypoint a curved or straight connector passes through to bow `offset` px beside the chord from `a` to `b`; the chord's middle when
 * the offset is 0.
 *
 * @public
 */
export function fanWaypoint(from: Vec2, to: Vec2, offset: number): Vec2 {
  const [a, b] = from.x < to.x || (from.x === to.x && from.y <= to.y) ? [from, to] : [to, from];
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const len = Math.hypot(dx, dy) || 1;
  return { x: (a.x + b.x) / 2 - (dy / len) * offset, y: (a.y + b.y) / 2 + (dx / len) * offset };
}
