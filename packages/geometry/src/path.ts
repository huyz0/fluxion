import { type Box, boxUnion } from './box.js';
import { err, ok, type Result } from './result.js';
import { lerp, type Vec2 } from './vec2.js';

/**
 * One drawing command of a path description, in absolute coordinates.
 *
 * @public
 */
export type PathCommand =
  | {
      /** Move to `to`, starting the subpath. */
      readonly kind: 'M';
      /** Start point. */
      readonly to: Vec2;
    }
  | {
      /** Straight line to `to`. */
      readonly kind: 'L';
      /** End point. */
      readonly to: Vec2;
    }
  | {
      /** Quadratic Bézier to `to`. */
      readonly kind: 'Q';
      /** Control point. */
      readonly control: Vec2;
      /** End point. */
      readonly to: Vec2;
    }
  | {
      /** Cubic Bézier to `to`. */
      readonly kind: 'C';
      /** First control point. */
      readonly control1: Vec2;
      /** Second control point. */
      readonly control2: Vec2;
      /** End point. */
      readonly to: Vec2;
    }
  | {
      /** Close the subpath with a straight line back to its start. */
      readonly kind: 'Z';
    };

/**
 * A cubic Bézier segment from `p0` to `p3` with control points `p1`, `p2`.
 *
 * @public
 */
export type CubicSegment = {
  /** Start point. */
  readonly p0: Vec2;
  /** First control point. */
  readonly p1: Vec2;
  /** Second control point. */
  readonly p2: Vec2;
  /** End point. */
  readonly p3: Vec2;
};

/**
 * A single subpath normalised to cubic segments; each segment starts where the previous one ends.
 *
 * @public
 */
export type Path = {
  /** Consecutive cubic segments. */
  readonly segments: readonly CubicSegment[];
  /** True when the path ended with `Z` (its last point equals its first). */
  readonly closed: boolean;
};

/** Cubic equivalent of the straight line `a → b`. */
function lineToCubic(a: Vec2, b: Vec2): CubicSegment {
  return { p0: a, p1: lerp(a, b, 1 / 3), p2: lerp(a, b, 2 / 3), p3: b };
}

/** Degree elevation of the quadratic `a, q, b` to a cubic. */
function quadToCubic(a: Vec2, q: Vec2, b: Vec2): CubicSegment {
  return { p0: a, p1: lerp(a, q, 2 / 3), p2: lerp(b, q, 2 / 3), p3: b };
}

function isFinitePoint(p: Vec2): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

function commandPoints(cmd: PathCommand): readonly Vec2[] {
  switch (cmd.kind) {
    case 'M':
    case 'L':
      return [cmd.to];
    case 'Q':
      return [cmd.control, cmd.to];
    case 'C':
      return [cmd.control1, cmd.control2, cmd.to];
    case 'Z':
      return [];
  }
}

function segmentFor(cmd: PathCommand, from: Vec2, start: Vec2): CubicSegment | null {
  switch (cmd.kind) {
    case 'L':
      return lineToCubic(from, cmd.to);
    case 'Q':
      return quadToCubic(from, cmd.control, cmd.to);
    case 'C':
      return { p0: from, p1: cmd.control1, p2: cmd.control2, p3: cmd.to };
    default:
      // 'Z': close with a line unless already at the start ('M' is rejected before this point)
      return from.x === start.x && from.y === start.y ? null : lineToCubic(from, start);
  }
}

function validate(cmds: readonly PathCommand[]): Result<Vec2> {
  const first = cmds[0];
  if (first === undefined || first.kind !== 'M') return err('PATH_MISSING_MOVE', 'A path must start with an M command.');
  for (const [i, cmd] of cmds.entries()) {
    if (i > 0 && cmd.kind === 'M') return err('PATH_MULTIPLE_SUBPATHS', `Command ${i} starts a second subpath; only one is supported.`);
    if (cmds[i - 1]?.kind === 'Z') return err('PATH_COMMAND_AFTER_CLOSE', `Command ${i} follows Z; nothing may follow a close.`);
    if (!commandPoints(cmd).every(isFinitePoint)) return err('PATH_INVALID_POINT', `Command ${i} has a non-finite coordinate.`);
  }
  return ok(first.to);
}

/**
 * Builds a cubic-normalised {@link Path} from absolute commands. Lines become cubics with control
 * points at 1/3 and 2/3, quadratics are degree-elevated, `Z` adds a closing line when needed.
 * Errors: `'PATH_MISSING_MOVE'`, `'PATH_MULTIPLE_SUBPATHS'`, `'PATH_COMMAND_AFTER_CLOSE'`, `'PATH_INVALID_POINT'`.
 *
 * @public
 */
export function pathFromCommands(cmds: readonly PathCommand[]): Result<Path> {
  const checked = validate(cmds);
  if (!checked.ok) return checked;
  const start = checked.value;
  const segments: CubicSegment[] = [];
  let current = start;
  for (const cmd of cmds.slice(1)) {
    const seg = segmentFor(cmd, current, start);
    if (seg !== null) {
      segments.push(seg);
      current = seg.p3;
    }
  }
  return ok({ segments, closed: cmds.at(-1)?.kind === 'Z' });
}

/**
 * Point on the segment at parameter `t` (0 = start, 1 = end).
 *
 * @public
 */
export function pointAt(seg: CubicSegment, t: number): Vec2 {
  const u = 1 - t;
  const b0 = u * u * u;
  const b1 = 3 * u * u * t;
  const b2 = 3 * u * t * t;
  const b3 = t * t * t;
  return {
    x: b0 * seg.p0.x + b1 * seg.p1.x + b2 * seg.p2.x + b3 * seg.p3.x,
    y: b0 * seg.p0.y + b1 * seg.p1.y + b2 * seg.p2.y + b3 * seg.p3.y,
  };
}

/**
 * First derivative `dB/dt` of the segment at `t` (the unnormalised tangent).
 *
 * @public
 */
export function derivativeAt(seg: CubicSegment, t: number): Vec2 {
  const u = 1 - t;
  const k0 = 3 * u * u;
  const k1 = 6 * u * t;
  const k2 = 3 * t * t;
  return {
    x: k0 * (seg.p1.x - seg.p0.x) + k1 * (seg.p2.x - seg.p1.x) + k2 * (seg.p3.x - seg.p2.x),
    y: k0 * (seg.p1.y - seg.p0.y) + k1 * (seg.p2.y - seg.p1.y) + k2 * (seg.p3.y - seg.p2.y),
  };
}

/**
 * Splits the segment at `t` (de Casteljau) into the parts covering `[0, t]` and `[t, 1]`.
 *
 * @public
 */
export function splitAt(seg: CubicSegment, t: number): readonly [CubicSegment, CubicSegment] {
  const a = lerp(seg.p0, seg.p1, t);
  const b = lerp(seg.p1, seg.p2, t);
  const c = lerp(seg.p2, seg.p3, t);
  const ab = lerp(a, b, t);
  const bc = lerp(b, c, t);
  const mid = lerp(ab, bc, t);
  return [
    { p0: seg.p0, p1: a, p2: ab, p3: mid },
    { p0: mid, p1: bc, p2: c, p3: seg.p3 },
  ];
}

/** Real roots of `a t² + b t + c = 0` (degenerate cases included). */
function quadraticRoots(a: number, b: number, c: number): readonly number[] {
  const scaleOf = Math.max(Math.abs(a), Math.abs(b), Math.abs(c));
  if (scaleOf === 0) return [];
  if (Math.abs(a) <= 1e-12 * scaleOf) return b === 0 ? [] : [-c / b];
  const disc = b * b - 4 * a * c;
  if (disc < 0) return [];
  const sq = Math.sqrt(disc);
  return [(-b + sq) / (2 * a), (-b - sq) / (2 * a)];
}

/** Parameters in (0, 1) where one coordinate of the cubic has a local extremum (package-internal). */
export function extremaParams(v0: number, v1: number, v2: number, v3: number): readonly number[] {
  const a = -v0 + 3 * v1 - 3 * v2 + v3;
  const b = 2 * (v0 - 2 * v1 + v2);
  const c = v1 - v0;
  return quadraticRoots(a, b, c).filter((t) => t > 0 && t < 1);
}

/**
 * Tight axis-aligned bounds of the segment (end points plus the curve's extrema).
 *
 * @public
 */
export function segmentBounds(seg: CubicSegment): Box {
  const ts = [0, 1, ...extremaParams(seg.p0.x, seg.p1.x, seg.p2.x, seg.p3.x), ...extremaParams(seg.p0.y, seg.p1.y, seg.p2.y, seg.p3.y)];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const t of ts) {
    const p = pointAt(seg, t);
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Tight bounds of the whole path, or `null` when it has no segments.
 *
 * @public
 */
export function pathBounds(path: Path): Box | null {
  let acc: Box | null = null;
  for (const seg of path.segments) {
    const b = segmentBounds(seg);
    acc = acc === null ? b : boxUnion(acc, b);
  }
  return acc;
}
