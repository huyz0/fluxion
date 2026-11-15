// Adaptive flattening of an operand's outline for the boolean operations (ADR-0053 step 2): each cubic is halved until every
// piece both lies within ε of its chord and turns its tangent by at most 10°, with ε = min(0.001 × D, 0.002 × L) (D the larger side
// of the operands' union box, L the segment's control polygon). The angle test compares dot and cross products against a constant
// cos 10°, squared: no transcendental call, so every engine subdivides alike (M19 cp1 F4). Pure.
import type { CubicSegment } from '../path.js';
import { splitAt } from '../path.js';
import type { Vec2 } from '../vec2.js';

/** cos² 10°: a piece's end tangents may part by at most 10°. */
const COS2_10 = 0.969846310392954;
/** Halvings at most: 2^16 pieces per segment, far beyond any tolerance reached in practice. */
const MAX_DEPTH = 16;

const minus = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const len2 = (v: Vec2): number => v.x * v.x + v.y * v.y;

/** The first of `vs` that has length: a tangent where control points coincide with an end. */
const firstNonZero = (vs: readonly Vec2[]): Vec2 => vs.find((v) => len2(v) > 0) ?? { x: 0, y: 0 };

/** Whether the tangents at the ends of `s` part by at most 10°: dot > 0 and dot² ≥ cos² 10° |a|² |b|². */
export function turnsLittle(s: CubicSegment): boolean {
  const a = firstNonZero([minus(s.p1, s.p0), minus(s.p2, s.p0), minus(s.p3, s.p0)]);
  const b = firstNonZero([minus(s.p3, s.p2), minus(s.p3, s.p1), minus(s.p3, s.p0)]);
  const d = a.x * b.x + a.y * b.y;
  const [la, lb] = [len2(a), len2(b)];
  // a point segment has no tangent to turn
  if (la === 0 || lb === 0) return true;
  return d > 0 && d * d >= COS2_10 * la * lb;
}

/** Whether both control points of `s` lie within `eps` of its chord (of its start, when the chord has no length). */
export function liesFlat(s: CubicSegment, eps: number): boolean {
  const chord = minus(s.p3, s.p0);
  const c2 = len2(chord);
  const off = (p: Vec2): number => {
    const v = minus(p, s.p0);
    if (c2 === 0) return len2(v);
    const x = chord.x * v.y - chord.y * v.x;
    return (x * x) / c2;
  };
  const e2 = eps * eps;
  return off(s.p1) <= e2 && off(s.p2) <= e2;
}

/** The length of `s`'s control polygon (square roots only: correctly rounded in every engine, unlike `Math.hypot`). */
export const controlLength = (s: CubicSegment): number =>
  Math.sqrt(len2(minus(s.p1, s.p0))) + Math.sqrt(len2(minus(s.p2, s.p1))) + Math.sqrt(len2(minus(s.p3, s.p2)));

/** The points `s` flattens to under `eps`, its start first and its end left out (the next segment starts there). */
function flattenSegment(s: CubicSegment, eps: number, depth: number, out: Vec2[]): void {
  if (depth >= MAX_DEPTH || (liesFlat(s, eps) && turnsLittle(s))) {
    out.push(s.p0);
    return;
  }
  const [a, b] = splitAt(s, 0.5);
  flattenSegment(a, eps, depth + 1, out);
  flattenSegment(b, eps, depth + 1, out);
}

/**
 * The closed ring of points `segments` (one closed ring, placed) flattens to, with `size` the larger side of the operands' union box.
 * A segment of no length adds nothing.
 */
export function flattenRing(segments: readonly CubicSegment[], size: number): Vec2[] {
  const out: Vec2[] = [];
  for (const s of segments) {
    const l = controlLength(s);
    if (!(l > 0)) continue;
    flattenSegment(s, Math.min(0.001 * size, 0.002 * l), 0, out);
  }
  return out;
}
