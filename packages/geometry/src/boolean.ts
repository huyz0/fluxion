// Boolean path operations (ADR-0053, FR-SHP-010): union, subtract, intersect and exclude over placed outlines. Each operand's rings
// are placed, flattened adaptively and resolved to their filled region under the operand's rule; polybooljs (MIT, no
// dependencies) combines the regions; the result's rings are oriented by nesting depth (outer one way, holes the other, so they
// fill alike under either rule), re-fitted to cubics and normalised into their own box, coordinates rounded to 2 decimals. Pure:
// the same inputs give the same bytes in every engine (dot and cross products, square roots, no transcendental call).
// The `@fluxion/geometry/boolean` entry: the player never imports it, so polybooljs stays out of its bundles.
import polybool, { type Polygon } from 'polybooljs';
import { fitRing } from './boolean/fit.js';
import { flattenRing } from './boolean/flatten.js';
import { area2, inRing, nonzeroParts, type Ring } from './boolean/rings.js';
import { type Box, boxUnion } from './box.js';
import type { GeometryError } from './errors.js';
import { apply, type Mat2d } from './mat2d.js';
import { type CubicSegment, type Path, pathBounds } from './path.js';
import type { FillRule } from './point-in-path.js';
import { err, ok, type Result } from './result.js';
import type { Vec2 } from './vec2.js';

export { booleanPlacement } from './boolean/place.js';

/**
 * A boolean operation: `subtract` takes every later operand from the first.
 *
 * @public
 */
export type BooleanOp = 'union' | 'subtract' | 'intersect' | 'exclude';

/**
 * An operand: its outline's closed rings in its own box, the matrix placing them, and the rule they fill under.
 *
 * @public
 */
export type BooleanOperand = {
  /** The outline's subpaths; open ones are closed. */
  readonly rings: readonly Path[];
  /** Own box to the shared (screen) frame: turn and flips included. */
  readonly matrix: Mat2d;
  /** How the rings fill together. */
  readonly fillRule: FillRule;
};

/**
 * A boolean result, normalised into its own box: `d` (absolute M, L, C, Z, 2 decimals) in a `w × h` box placed at `box`.
 *
 * @public
 */
export type BooleanResult = {
  /** Where the result sits in the shared frame. */
  readonly box: Box;
  /** The path data, in the box from its corner. */
  readonly d: string;
  /** Its rings fill alike under either rule: outer rings one way, holes the other. */
  readonly fillRule: 'evenodd';
  /** Cubic segments in `d`. */
  readonly segments: number;
  /** Closed rings in `d`. */
  readonly rings: number;
};

const placed = (seg: CubicSegment, m: Mat2d): CubicSegment => ({ p0: apply(m, seg.p0), p1: apply(m, seg.p1), p2: apply(m, seg.p2), p3: apply(m, seg.p3) });

/** `operand`'s region as an even-odd polygon, its rings flattened for an operation of extent `size`. */
function regionOf(rings: readonly Ring[], fillRule: FillRule): Polygon {
  const asRegions = (rs: readonly Ring[]): number[][][] => rs.map((r) => r.map((p) => [p.x, p.y]));
  if (fillRule === 'evenodd') return { regions: asRegions(rings), inverted: false };
  const parts = nonzeroParts(rings).map((rs): Polygon => ({ regions: asRegions(rs), inverted: false }));
  return parts.reduce((a, b) => polybool.union(a, b), { regions: [], inverted: false });
}

const OPS: Readonly<Record<BooleanOp, (a: Polygon, b: Polygon) => Polygon>> = {
  union: (a, b) => polybool.union(a, b),
  subtract: (a, b) => polybool.difference(a, b),
  intersect: (a, b) => polybool.intersect(a, b),
  exclude: (a, b) => polybool.xor(a, b),
};

/** `rings` each wound by its depth among the others: outer rings negative (counter-clockwise on screen), holes positive. */
function oriented(rings: readonly Ring[]): Ring[] {
  return rings.map((r, i) => {
    const depth = rings.filter((o, j) => j !== i && Math.abs(area2(o)) > Math.abs(area2(r)) && inRing(o, r[0] as Vec2)).length;
    const wanted = depth % 2 === 0 ? -1 : 1;
    return Math.sign(area2(r)) === wanted ? r : [...r].reverse();
  });
}

/**
 * Each point's fitting tolerance in `r`, 2ε at the scale it was flattened at: a chord of a curve flattened to ε turns ≤ 10°, so ε
 * is about 0.02 of the chord (ε = 0.002 × L of a quarter arc of control length L); never above 2 × 0.001 × `size` (ADR-0053 step 6).
 */
function tolerances(r: Ring, size: number): number[] {
  const n = r.length;
  const chord = (i: number): number => {
    const [a, b] = [r[i] as Vec2, r[(i + 1) % n] as Vec2];
    const [dx, dy] = [b.x - a.x, b.y - a.y];
    return Math.sqrt(dx * dx + dy * dy);
  };
  return r.map((_, i) => 2 * Math.min(0.001 * size, 0.02 * Math.min(chord(i), chord((i + n - 1) % n))));
}

const round = (n: number): number => {
  const r = Math.round(n * 100) / 100;
  return r === 0 ? 0 : r;
};
const pt = (p: Vec2, o: Vec2): string => `${round(p.x - o.x)} ${round(p.y - o.y)}`;

/** `paths` as path data from corner `o`: lines as L, curves as C, each ring closed. */
function pathData(paths: readonly (readonly CubicSegment[])[], o: Vec2): string {
  return paths
    .map((segs) => {
      const body = segs.map((s) => {
        const straight =
          round(s.p1.x - (2 * s.p0.x + s.p3.x) / 3) === 0 &&
          round(s.p1.y - (2 * s.p0.y + s.p3.y) / 3) === 0 &&
          round(s.p2.x - (s.p0.x + 2 * s.p3.x) / 3) === 0 &&
          round(s.p2.y - (s.p0.y + 2 * s.p3.y) / 3) === 0;
        return straight ? `L ${pt(s.p3, o)}` : `C ${pt(s.p1, o)} ${pt(s.p2, o)} ${pt(s.p3, o)}`;
      });
      return `M ${pt((segs[0] as CubicSegment).p0, o)} ${body.join(' ')} Z`;
    })
    .join(' ');
}

const fail = (code: 'BOOLEAN_OPERANDS' | 'BOOLEAN_EMPTY', message: string): Result<never, GeometryError> => err({ code, message });

/**
 * `op` over `operands` in order (bottom first: `subtract` takes the rest from the first). Errors: `'BOOLEAN_OPERANDS'` for fewer
 * than two operands or one with no closed area, `'BOOLEAN_EMPTY'` when the result has no area (a disjoint intersect, a subtract
 * that leaves nothing); nothing else fails.
 *
 * @public
 */
export function booleanPaths(op: BooleanOp, operands: readonly BooleanOperand[]): Result<BooleanResult, GeometryError> {
  if (operands.length < 2) return fail('BOOLEAN_OPERANDS', 'a boolean operation needs two operands or more');
  const segs = operands.map((o) => o.rings.map((r) => r.segments.map((s) => placed(s, o.matrix))));
  const boxes = segs.flat().flatMap((r) => {
    const b = pathBounds({ segments: r, closed: true });
    return b === null ? [] : [b];
  });
  if (boxes.length === 0) return fail('BOOLEAN_OPERANDS', 'the operands have no outline');
  const extent = boxes.reduce(boxUnion);
  const size = Math.max(extent.w, extent.h);
  const polygons = segs.map((rs, i) =>
    regionOf(
      rs.map((r) => flattenRing(r, size)).filter((r) => r.length >= 3),
      (operands[i] as BooleanOperand).fillRule,
    ),
  );
  const combined = polygons.slice(1).reduce(OPS[op], polygons[0] as Polygon);
  const rings = combined.regions.map((r) => r.map(([x, y]) => ({ x: x as number, y: y as number }))).filter((r) => r.length >= 3 && Math.abs(area2(r)) > 0);
  // a sliver below the flattening tolerance is no area
  const total = rings.reduce((sum, r) => sum + Math.abs(area2(r)) / 2, 0);
  if (!(total > 0.001 * size * (0.001 * size))) return fail('BOOLEAN_EMPTY', `the ${op} has no area`);
  const fitted = oriented(rings).map((r) => fitRing(r, tolerances(r, size)));
  const bounds = fitted.map((s) => pathBounds({ segments: s, closed: true }) as Box).reduce(boxUnion);
  const o = { x: round(bounds.x), y: round(bounds.y) };
  const box = { x: o.x, y: o.y, w: round(bounds.x + bounds.w - o.x), h: round(bounds.y + bounds.h - o.y) };
  return ok({ box, d: pathData(fitted, o), fillRule: 'evenodd', segments: fitted.reduce((n, s) => n + s.length, 0), rings: fitted.length });
}
