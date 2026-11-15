// Re-fitting a boolean result's rings to cubics (ADR-0053 step 6): each ring is split at its corners (a turn over 30°; flattening
// never makes one, so they are the operands' own corners and the crossings), each run between corners becomes one line when its
// points lie within the tolerance of their chord, else cubics fitted by Schneider's algorithm (Graphics Gems, 1990) to a maximum
// error of the tolerance. Pure: square roots, products and sums only.
import type { CubicSegment } from '../path.js';
import type { Vec2 } from '../vec2.js';
import type { Ring } from './rings.js';

/** cos² 30°: a turn sharper than 30° is a corner. */
const COS2_30 = 0.75;
/** Newton steps that re-parametrize a fit before it is split. */
const REPARAMETRIZE = 4;

const minus = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const plus = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const times = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
const dotOf = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
const len = (a: Vec2): number => Math.sqrt(dotOf(a, a));
const unit = (a: Vec2): Vec2 => {
  const l = len(a);
  return l === 0 ? a : times(a, 1 / l);
};

/** Whether the ring turns by more than 30° at `b`, coming from `a` and going to `c`. */
function isCorner(a: Vec2, b: Vec2, c: Vec2): boolean {
  const [u, v] = [minus(b, a), minus(c, b)];
  const d = dotOf(u, v);
  return d <= 0 || d * d < COS2_30 * dotOf(u, u) * dotOf(v, v);
}

/** The indices of `r`'s corners; its first point when it has none (a circle is cut once). */
export function corners(r: Ring): number[] {
  const n = r.length;
  const found = r.flatMap((p, i) => (isCorner(r[(i + n - 1) % n] as Vec2, p, r[(i + 1) % n] as Vec2) ? [i] : []));
  return found.length === 0 ? [0] : found;
}

const line = (a: Vec2, b: Vec2): CubicSegment => ({ p0: a, p1: plus(a, times(minus(b, a), 1 / 3)), p2: plus(a, times(minus(b, a), 2 / 3)), p3: b });

/** The point of `s` at `t`. */
function at(s: CubicSegment, t: number): Vec2 {
  const u = 1 - t;
  const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return { x: a * s.p0.x + b * s.p1.x + c * s.p2.x + d * s.p3.x, y: a * s.p0.y + b * s.p1.y + c * s.p2.y + d * s.p3.y };
}

/** Chord-length parameters of `pts`, from 0 to 1. */
function chordParams(pts: readonly Vec2[]): number[] {
  const u = [0];
  for (let i = 1; i < pts.length; i++) u.push((u[i - 1] as number) + len(minus(pts[i] as Vec2, pts[i - 1] as Vec2)));
  const total = u[u.length - 1] as number;
  return u.map((x) => (total === 0 ? 0 : x / total));
}

/** The least-squares cubic through `pts` at parameters `u`, leaving along `t1` and arriving along `t2` (Schneider's generateBezier). */
function generate(pts: readonly Vec2[], u: readonly number[], t1: Vec2, t2: Vec2): CubicSegment {
  const [first, last] = [pts[0] as Vec2, pts[pts.length - 1] as Vec2];
  let [c00, c01, c11, x0, x1] = [0, 0, 0, 0, 0];
  pts.forEach((p, i) => {
    const t = u[i] as number;
    const s = 1 - t;
    const a1 = times(t1, 3 * s * s * t);
    const a2 = times(t2, 3 * s * t * t);
    c00 += dotOf(a1, a1);
    c01 += dotOf(a1, a2);
    c11 += dotOf(a2, a2);
    const base = plus(times(first, s * s * s + 3 * s * s * t), times(last, 3 * s * t * t + t * t * t));
    const rest = minus(p, base);
    x0 += dotOf(a1, rest);
    x1 += dotOf(a2, rest);
  });
  const det = c00 * c11 - c01 * c01;
  const seg = len(minus(last, first));
  let [al, ar] = det === 0 ? [0, 0] : [(x0 * c11 - c01 * x1) / det, (c00 * x1 - c01 * x0) / det];
  // a degenerate or backward fit falls back to the Wu–Barsky heuristic
  if (!(al > 1e-6 * seg && ar > 1e-6 * seg)) [al, ar] = [seg / 3, seg / 3];
  return { p0: first, p1: plus(first, times(t1, al)), p2: plus(last, times(t2, ar)), p3: last };
}

/** The squared distance of the farthest of `pts` from `s` at its parameter, and its index. */
function maxError(pts: readonly Vec2[], s: CubicSegment, u: readonly number[]): readonly [number, number] {
  let [worst, index] = [0, Math.floor(pts.length / 2)];
  pts.forEach((p, i) => {
    const d = minus(at(s, u[i] as number), p);
    const e = dotOf(d, d);
    if (e > worst) [worst, index] = [e, i];
  });
  return [worst, index];
}

/** One Newton step of each parameter toward its point's nearest place on `s`. */
function reparametrize(pts: readonly Vec2[], s: CubicSegment, u: readonly number[]): number[] {
  const d1 = [times(minus(s.p1, s.p0), 3), times(minus(s.p2, s.p1), 3), times(minus(s.p3, s.p2), 3)] as const;
  const d2 = [times(minus(d1[1], d1[0]), 2), times(minus(d1[2], d1[1]), 2)] as const;
  return pts.map((p, i) => {
    const t = u[i] as number;
    const s1 = 1 - t;
    const q = minus(at(s, t), p);
    const q1 = plus(plus(times(d1[0], s1 * s1), times(d1[1], 2 * s1 * t)), times(d1[2], t * t));
    const q2 = plus(times(d2[0], s1), times(d2[1], t));
    const den = dotOf(q1, q1) + dotOf(q, q2);
    const next = den === 0 ? t : t - dotOf(q, q1) / den;
    return Math.min(1, Math.max(0, next));
  });
}

/** Cubics within `tol` of `pts`, leaving along `ends[0]` and arriving along `ends[1]`, split at the worst point while they are not. */
function fitRun(pts: readonly Vec2[], ends: readonly [Vec2, Vec2], tol: number, out: CubicSegment[]): void {
  const [t1, t2] = ends;
  if (pts.length === 2) {
    out.push(line(pts[0] as Vec2, pts[1] as Vec2));
    return;
  }
  let u = chordParams(pts);
  let s = generate(pts, u, t1, t2);
  let [e, split] = maxError(pts, s, u);
  for (let k = 0; k < REPARAMETRIZE && e > tol * tol && e < 16 * tol * tol; k++) {
    u = reparametrize(pts, s, u);
    s = generate(pts, u, t1, t2);
    [e, split] = maxError(pts, s, u);
  }
  if (e <= tol * tol) {
    out.push(s);
    return;
  }
  const mid = Math.min(pts.length - 2, Math.max(1, split));
  const centre = unit(minus(pts[mid - 1] as Vec2, pts[mid + 1] as Vec2));
  fitRun(pts.slice(0, mid + 1), [t1, centre], tol, out);
  fitRun(pts.slice(mid), [times(centre, -1), t2], tol, out);
}

/** Whether every one of `pts` lies within `tol` of the chord from its first to its last. */
function straight(pts: readonly Vec2[], tol: number): boolean {
  const [a, b] = [pts[0] as Vec2, pts[pts.length - 1] as Vec2];
  const c = minus(b, a);
  const c2 = dotOf(c, c);
  return pts.every((p) => {
    const v = minus(p, a);
    const x = c.x * v.y - c.y * v.x;
    return c2 === 0 ? dotOf(v, v) <= tol * tol : (x * x) / c2 <= tol * tol;
  });
}

/**
 * The closed ring `r` as cubics: a line for each straight run between corners, fitted cubics otherwise, each run within the
 * tightest of its points' tolerances `tol` (one per point of `r`).
 */
export function fitRing(r: Ring, tol: readonly number[]): CubicSegment[] {
  const cut = corners(r);
  const n = r.length;
  // a ring with no corners is cut once at a smooth point: both ends of its one run take the central tangent there
  const smooth = cut.length === 1 && cut[0] === 0 && !isCorner(r[n - 1] as Vec2, r[0] as Vec2, r[1] as Vec2);
  const out: CubicSegment[] = [];
  cut.forEach((from, k) => {
    const to = cut[(k + 1) % cut.length] as number;
    const steps = (to - from + r.length) % r.length || r.length;
    const index = Array.from({ length: steps + 1 }, (_, i) => (from + i) % r.length);
    const pts = index.map((i) => r[i] as Vec2);
    const runTol = Math.min(...index.map((i) => tol[i] as number));
    if (straight(pts, runTol)) {
      out.push(line(pts[0] as Vec2, pts[pts.length - 1] as Vec2));
      return;
    }
    const centre = unit(minus(r[1] as Vec2, r[n - 1] as Vec2));
    const ends: [Vec2, Vec2] = smooth
      ? [centre, { x: -centre.x, y: -centre.y }]
      : [unit(minus(pts[1] as Vec2, pts[0] as Vec2)), unit(minus(pts[pts.length - 2] as Vec2, pts[pts.length - 1] as Vec2))];
    fitRun(pts, ends, runTol, out);
  });
  return out;
}
