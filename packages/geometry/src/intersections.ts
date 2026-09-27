import { type CubicSegment, derivativeAt, type Path, pointAt, splitAt } from './path.js';
import { cross, sub, type Vec2 } from './vec2.js';

/**
 * A straight line segment between two points.
 *
 * @public
 */
export type LineSegment = readonly [start: Vec2, end: Vec2];

const DEFAULT_EPS = 1e-6;
/** Subdivision depth cap; one piece is split per level, so this is 48 levels of each. */
const MAX_DEPTH = 96;
/** Slack on line parameters so hits exactly at split points are not lost to rounding. */
const PARAM_SLACK = 1e-9;

type Hull = { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number };

/**
 * Intersection point of two line segments, or `null` when they miss or are parallel
 * (collinear overlaps also return `null`). Symmetric: `intersectSegments(a, b)` equals `intersectSegments(b, a)`.
 *
 * @public
 */
export function intersectSegments(a: LineSegment, b: LineSegment): Vec2 | null {
  return intersectWithSlack(a, b, 0);
}

function intersectWithSlack(a: LineSegment, b: LineSegment, slack: number): Vec2 | null {
  const [a0, a1] = a;
  const [b0, b1] = b;
  const r = sub(a1, a0);
  const s = sub(b1, b0);
  const denom = cross(r, s);
  if (Math.abs(denom) <= 1e-12 * (Math.hypot(r.x, r.y) * Math.hypot(s.x, s.y))) return null;
  const q = sub(b0, a0);
  const t = cross(q, s) / denom;
  const u = cross(q, r) / denom;
  if (t < -slack || t > 1 + slack || u < -slack || u > 1 + slack) return null;
  // average both evaluations so swapping the arguments gives a bit-identical point
  return { x: (a0.x + t * r.x + (b0.x + u * s.x)) / 2, y: (a0.y + t * r.y + (b0.y + u * s.y)) / 2 };
}

function hullOf(seg: CubicSegment, pad: number): Hull {
  const xs = [seg.p0.x, seg.p1.x, seg.p2.x, seg.p3.x];
  const ys = [seg.p0.y, seg.p1.y, seg.p2.y, seg.p3.y];
  return { minX: Math.min(...xs) - pad, minY: Math.min(...ys) - pad, maxX: Math.max(...xs) + pad, maxY: Math.max(...ys) + pad };
}

function hullsOverlap(a: Hull, b: Hull): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

/** Largest distance of the control points from the chord `p0 → p3`. */
function flatness(seg: CubicSegment): number {
  const chord = sub(seg.p3, seg.p0);
  const len = Math.hypot(chord.x, chord.y);
  const off = (p: Vec2): number => {
    const d = sub(p, seg.p0);
    return len === 0 ? Math.hypot(d.x, d.y) : Math.abs(cross(chord, d)) / len;
  };
  return Math.max(off(seg.p1), off(seg.p2));
}

type Search = { readonly eps: number; readonly out: Vec2[] };

/** Chords closer to parallel than this (the sine of their angle) are checked for overlap. */
const NEAR_PARALLEL = 0.1;

const NEWTON_STEPS = 8;

/** Second derivative of the segment at `t`. */
function secondDerivativeAt(seg: CubicSegment, t: number): Vec2 {
  const u = 1 - t;
  const ax = seg.p2.x - 2 * seg.p1.x + seg.p0.x;
  const ay = seg.p2.y - 2 * seg.p1.y + seg.p0.y;
  const bx = seg.p3.x - 2 * seg.p2.x + seg.p1.x;
  const by = seg.p3.y - 2 * seg.p2.y + seg.p1.y;
  return { x: 6 * (u * ax + t * bx), y: 6 * (u * ay + t * by) };
}

/**
 * Whether `p` is within `eps` of piece `seg`, cheaply: a chord-line bound rejects most points at
 * once (the curve stays within its flatness of the chord line), then a few Newton steps from the
 * point's projection on the chord find a nearby curve point. The distance found is to a real point
 * of the curve, so a miss only means "not shown on it" and never prunes wrongly; it is sound for
 * pruning, and cheap enough to run at every near-parallel node (M2.16 review r2 F1).
 */
function onSegment(seg: CubicSegment, p: Vec2, eps: number): boolean {
  const chord = sub(seg.p3, seg.p0);
  const len2 = chord.x * chord.x + chord.y * chord.y;
  const d = sub(p, seg.p0);
  const off = len2 === 0 ? Math.hypot(d.x, d.y) : Math.abs(cross(chord, d)) / Math.sqrt(len2);
  if (off > flatness(seg) + eps) return false;
  let t = len2 === 0 ? 0.5 : Math.min(1, Math.max(0, (d.x * chord.x + d.y * chord.y) / len2));
  for (let i = 0; i < NEWTON_STEPS; i++) {
    const e = sub(pointAt(seg, t), p);
    const d1 = derivativeAt(seg, t);
    const d2 = secondDerivativeAt(seg, t);
    const f1 = e.x * d1.x + e.y * d1.y;
    const f2 = d1.x * d1.x + d1.y * d1.y + e.x * d2.x + e.y * d2.y;
    if (f2 <= 0) break;
    t = Math.min(1, Math.max(0, t - f1 / f2));
  }
  const q = pointAt(seg, t);
  return Math.hypot(q.x - p.x, q.y - p.y) <= eps;
}

/** Whether piece `x` lies along `y` within `eps`: its ends and its midpoint are on `y`. */
const liesAlong = (x: CubicSegment, y: CubicSegment, eps: number): boolean =>
  onSegment(y, x.p0, eps) && onSegment(y, x.p3, eps) && onSegment(y, pointAt(x, 0.5), eps);

/**
 * Whether two pieces overlap along a stretch (coincident curves): their chords are near parallel
 * and one lies along the other. Without this, coincident curves stay in contact at every level and
 * the subdivision reports a point per eps-flat piece (M2.16 review F1).
 */
function overlapping(a: CubicSegment, b: CubicSegment, eps: number): boolean {
  const r = sub(a.p3, a.p0);
  const s = sub(b.p3, b.p0);
  const scale = Math.hypot(r.x, r.y) * Math.hypot(s.x, s.y);
  if (scale === 0 || Math.abs(cross(r, s)) > NEAR_PARALLEL * scale) return false;
  return liesAlong(a, b, eps) || liesAlong(b, a, eps);
}

/**
 * Whether `y` lies wholly on one side of the band `x` sweeps around its chord line (the signed
 * distances of `x`'s control points, widened by `eps`): then the pieces cannot meet. Curves that
 * run close together keep overlapping bounding boxes to deep levels; this separates them as soon
 * as the pieces are flatter than their gap (fat-line test, M2.16 review r2 F1).
 */
function outsideBand(x: CubicSegment, y: CubicSegment, eps: number): boolean {
  const chord = sub(x.p3, x.p0);
  const len = Math.hypot(chord.x, chord.y);
  if (len === 0) return false;
  const signed = (p: Vec2): number => cross(chord, sub(p, x.p0)) / len;
  const band = [signed(x.p1), signed(x.p2)];
  const lo = Math.min(0, ...band) - eps;
  const hi = Math.max(0, ...band) + eps;
  const ds = [y.p0, y.p1, y.p2, y.p3].map(signed);
  return ds.every((d) => d < lo) || ds.every((d) => d > hi);
}

/** Pieces that cannot cross: bounds apart, separated by a fat line, or one lying along the other. */
const apart = (a: CubicSegment, b: CubicSegment, eps: number): boolean =>
  !hullsOverlap(hullOf(a, eps), hullOf(b, eps)) || outsideBand(a, b, eps) || outsideBand(b, a, eps) || overlapping(a, b, eps);

function subdivide(a: CubicSegment, b: CubicSegment, search: Search, depth: number): void {
  if (apart(a, b, search.eps)) return;
  const aFlatness = flatness(a);
  const bFlatness = flatness(b);
  if ((aFlatness <= search.eps && bFlatness <= search.eps) || depth >= MAX_DEPTH) {
    const hit = intersectWithSlack([a.p0, a.p3], [b.p0, b.p3], PARAM_SLACK);
    if (hit !== null) search.out.push(hit);
    return;
  }
  // split only the less flat piece: two branches per level instead of four, so curves that run
  // close together for a stretch cost linear, not quadratic, work in the pieces they overlap
  if (aFlatness >= bFlatness) for (const x of splitAt(a, 0.5)) subdivide(x, b, search, depth + 1);
  else for (const y of splitAt(b, 0.5)) subdivide(a, y, search, depth + 1);
}

function comparePoints(p: Vec2, q: Vec2): number {
  return p.x - q.x || p.y - q.y;
}

/** Sorts by x then y and drops points within `eps` (per axis) of an already kept point. */
function dedupeSorted(points: readonly Vec2[], eps: number): Vec2[] {
  const kept: Vec2[] = [];
  for (const p of [...points].sort(comparePoints)) {
    if (!kept.some((k) => Math.abs(k.x - p.x) <= eps && Math.abs(k.y - p.y) <= eps)) kept.push(p);
  }
  return kept;
}

/**
 * Intersection points of two cubic segments by recursive bounding-box subdivision, deduplicated
 * within `eps` and sorted by x then y. A stretch where the curves coincide is not a crossing: it
 * reports no points of its own, only (at most) points where the subdivision's pieces meet on it.
 * Cost grows with the length of stretches where the curves run within a few `eps` of each other
 * without coinciding: those pieces can only be told apart once they are about `eps` flat.
 *
 * @param eps - flatness and deduplication tolerance (default `1e-6`)
 * @public
 */
export function intersectCubics(s1: CubicSegment, s2: CubicSegment, eps: number = DEFAULT_EPS): Vec2[] {
  const search: Search = { eps, out: [] };
  subdivide(s1, s2, search, 0);
  return dedupeSorted(search.out, eps);
}

/**
 * All intersection points between two paths, deduplicated within `eps` and sorted by x then y.
 *
 * @param eps - flatness and deduplication tolerance (default `1e-6`)
 * @public
 */
export function intersectPaths(p1: Path, p2: Path, eps: number = DEFAULT_EPS): Vec2[] {
  const search: Search = { eps, out: [] };
  for (const a of p1.segments) for (const b of p2.segments) subdivide(a, b, search, 0);
  return dedupeSorted(search.out, eps);
}
