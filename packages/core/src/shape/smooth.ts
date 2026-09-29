// Smooth points outlines (ADR-0016 item 1): a uniform Catmull-Rom curve through the vertices, as cubics.
// Each vertex has one tangent, shared by the segments on either side, so the curve is C1. A tangent is
// fitted to the box, so the curve stays inside it: a component pointing out of the box at a vertex
// on its edge is dropped (the stroke runs along the edge there), and the rest is scaled until both
// control points are inside (M5.11 review F1).
import type { PathCommand, Vec2 } from '@fluxion/geometry';
import type { Size } from '@fluxion/schema';

/** The control points a vertex's tangent places: after it (+) and before it (-). */
type Sides = { readonly plus: boolean; readonly minus: boolean };

const BOTH: Sides = { plus: true, minus: true };

/** Whether moving `c` from `v` (in 0…max) leaves the range on a side in use. */
function leaves(c: number, v: number, max: number, sides: Sides): boolean {
  // tzap disable next-line EqualityOperator: a zero component is the same dropped or kept
  const forwards = c >= 0;
  // at an edge, the side moving towards it leaves the box
  const [ahead, behind] = forwards ? [v >= max, v <= 0] : [v <= 0, v >= max];
  return (sides.plus && ahead) || (sides.minus && behind);
}

/** The largest scale of `c` that keeps `v ± c` in 0…max on the sides in use. */
function room(c: number, v: number, max: number, sides: Sides): number {
  if (c === 0) return 1;
  // tzap disable next-line EqualityOperator: c is not zero here
  const forwards = c > 0;
  const [up, down] = forwards ? [(max - v) / c, v / c] : [v / -c, (max - v) / -c];
  return Math.min(sides.plus ? up : 1, sides.minus ? down : 1);
}

/** The tangent `t` at vertex `p`, fitted to the box. */
function fitTangent(p: Vec2, t: Vec2, sides: Sides, size: Size): Vec2 {
  const x = leaves(t.x, p.x, size.w, sides) ? 0 : t.x;
  const y = leaves(t.y, p.y, size.h, sides) ? 0 : t.y;
  const s = Math.min(1, room(x, p.x, size.w, sides), room(y, p.y, size.h, sides));
  return { x: x * s, y: y * s };
}

/**
 * The curve through `p` (inside the `size` box) as geometry commands: ends repeat their vertex, a
 * closed curve wraps.
 */
export function catmullRom(p: readonly Vec2[], closed: boolean, size: Size): PathCommand[] {
  const m = p.length;
  const at = (k: number) => (closed ? p[(k + m) % m] : p[Math.min(Math.max(k, 0), m - 1)]) as Vec2;
  const tangents = p.map((v, k) => {
    const [prev, next] = [at(k - 1), at(k + 1)];
    return fitTangent(v, { x: (next.x - prev.x) / 6, y: (next.y - prev.y) / 6 }, closed ? BOTH : { plus: k < m - 1, minus: k > 0 }, size);
  });
  const segments = Array.from({ length: closed ? m : m - 1 }, (_, k): PathCommand => {
    const [a, b] = [at(k), at(k + 1)];
    const [ta, tb] = [tangents[k] as Vec2, tangents[(k + 1) % m] as Vec2];
    return { kind: 'C', control1: { x: a.x + ta.x, y: a.y + ta.y }, control2: { x: b.x - tb.x, y: b.y - tb.y }, to: b };
  });
  return [{ kind: 'M', to: at(0) }, ...segments];
}
