// The path tool's model (FR-SHP-011, ADR-0053): a `core:path` shape's `d` read as subpaths of vertices joined by lines or
// cubics, the edits the tool makes to it (move a vertex with its handles, move a bezier handle, add a point on a segment, remove
// a point), and the path data written back. Coordinates are the path's own reference box (`path.w × path.h`). Q segments are
// read as the cubics they equal; a closing Z that is not already at the start becomes a line. Pure.
import { type CubicSegment, type PathCommand, parsePathData, splitAt, type Vec2 } from '@fluxion/geometry';

/** A segment from one vertex to the next: straight, or a cubic with its two handles. */
export type EditSegment = { readonly kind: 'L' } | { readonly kind: 'C'; readonly c1: Vec2; readonly c2: Vec2 };

/** A subpath: its vertices, and the segment after each (to the next, and from the last back to the first when closed). */
export type EditSubpath = {
  /** Whether the last vertex joins the first. */
  readonly closed: boolean;
  /** The vertices, in order. */
  readonly points: readonly Vec2[];
  /** Segment `i` runs from vertex `i` to vertex `i + 1` (wrapping when closed): one per vertex closed, one fewer open. */
  readonly segments: readonly EditSegment[];
};

/** A path as the tool edits it. */
export type EditPath = readonly EditSubpath[];

/** A handle of the path: a vertex, or one of the two bezier handles of a cubic segment. */
export type PathHandle =
  | { readonly kind: 'vertex'; readonly sub: number; readonly index: number }
  | { readonly kind: 'c1' | 'c2'; readonly sub: number; readonly index: number };

const near = (a: Vec2, b: Vec2) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
const mix = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** The segment each drawing command makes, from the vertex `last` (M and Z make none). */
const SEGMENT_OF: { readonly [K in PathCommand['kind']]: (c: Extract<PathCommand, { kind: K }>, last: Vec2) => EditSegment | undefined } = {
  M: () => undefined,
  Z: () => undefined,
  L: () => ({ kind: 'L' }),
  C: (c) => ({ kind: 'C', c1: c.control1, c2: c.control2 }),
  Q: (c, last) => ({ kind: 'C', c1: mix(last, c.control, 2 / 3), c2: mix(c.to, c.control, 2 / 3) }),
};

/** One subpath's commands as vertices and segments. */
function subpathOf(cmds: readonly PathCommand[]): EditSubpath {
  const points: Vec2[] = [];
  const segments: EditSegment[] = [];
  for (const c of cmds) {
    const seg = (SEGMENT_OF[c.kind] as (c: PathCommand, last: Vec2) => EditSegment | undefined)(c, points[points.length - 1] as Vec2);
    if (seg !== undefined) segments.push(seg);
    if ('to' in c) points.push(c.to);
  }
  const closed = cmds.some((c) => c.kind === 'Z');
  // a closed subpath's last vertex is its first again when its last segment ends there; else Z draws a line back
  if (closed && points.length > 1 && near(points[0] as Vec2, points[points.length - 1] as Vec2)) points.pop();
  else if (closed) segments.push({ kind: 'L' });
  return { closed, points, segments };
}

/**
 * `d` as the path tool edits it; undefined when it does not read.
 *
 * @public
 */
export function readEditPath(d: string): EditPath | undefined {
  const parsed = parsePathData(d);
  return parsed.ok ? parsed.value.map(subpathOf) : undefined;
}

/** The vertex after vertex `i` of `s`. */
const nextOf = (s: EditSubpath, i: number) => s.points[(i + 1) % s.points.length] as Vec2;

/**
 * Segment `index` of subpath `sub` as a cubic (a line's handles at its thirds), for drawing, hit-testing and bounds.
 *
 * @public
 */
export function segmentCubic(s: EditSubpath, index: number): CubicSegment {
  const seg = s.segments[index] as EditSegment;
  const [p0, p3] = [s.points[index] as Vec2, nextOf(s, index)];
  return seg.kind === 'C' ? { p0, p1: seg.c1, p2: seg.c2, p3 } : { p0, p1: mix(p0, p3, 1 / 3), p2: mix(p0, p3, 2 / 3), p3 };
}

/**
 * Every segment of `path` as a cubic.
 *
 * @public
 */
export function editCubics(path: EditPath): readonly CubicSegment[] {
  return path.flatMap((s) => s.segments.map((_, i) => segmentCubic(s, i)));
}

/**
 * Where handle `h` of `path` is; undefined when there is no such handle.
 *
 * @public
 */
export function handlePoint(path: EditPath, h: PathHandle): Vec2 | undefined {
  const s = path[h.sub];
  if (s === undefined) return undefined;
  if (h.kind === 'vertex') return s.points[h.index];
  const seg = s.segments[h.index];
  return seg?.kind === 'C' ? seg[h.kind] : undefined; // kind-switch-allow: a path segment's closed kind (L or C)
}

/**
 * Every handle of `path`: each vertex, then each cubic's two handles.
 *
 * @public
 */
export function pathHandles(path: EditPath): readonly PathHandle[] {
  return path.flatMap((s, sub) => [
    ...s.points.map((_, index): PathHandle => ({ kind: 'vertex', sub, index })),
    ...s.segments.flatMap((seg, index): PathHandle[] =>
      seg.kind === 'C'
        ? [
            { kind: 'c1', sub, index },
            { kind: 'c2', sub, index },
          ]
        : [],
    ),
  ]);
}

const moved = (p: Vec2, d: Vec2): Vec2 => ({ x: p.x + d.x, y: p.y + d.y });

/** Subpath `s` with vertex `i` at `to`, the handles beside it moved with it. */
function withVertex(s: EditSubpath, i: number, to: Vec2): EditSubpath {
  const from = s.points[i] as Vec2;
  const d = { x: to.x - from.x, y: to.y - from.y };
  const n = s.points.length;
  // the segment arriving at i and the one leaving it
  const before = s.closed ? (i + n - 1) % n : i - 1;
  const segments = s.segments.map((seg, k): EditSegment => {
    if (seg.kind !== 'C') return seg;
    if (k === i && k === before) return { kind: 'C', c1: moved(seg.c1, d), c2: moved(seg.c2, d) };
    if (k === i) return { ...seg, c1: moved(seg.c1, d) };
    return k === before ? { ...seg, c2: moved(seg.c2, d) } : seg;
  });
  return { ...s, points: s.points.map((p, k) => (k === i ? to : p)), segments };
}

const replaceAt = <T>(list: readonly T[], i: number, value: T): T[] => list.map((x, k) => (k === i ? value : x));

/**
 * `path` with handle `h` at `to`: a vertex brings its bezier handles along; a bezier handle moves alone.
 *
 * @public
 */
export function moveHandle(path: EditPath, h: PathHandle, to: Vec2): EditPath {
  const s = path[h.sub];
  if (s === undefined) return path;
  if (h.kind === 'vertex') return replaceAt(path, h.sub, withVertex(s, h.index, to));
  const seg = s.segments[h.index];
  if (seg?.kind !== 'C') return path; // kind-switch-allow: a path segment's closed kind (L or C)
  return replaceAt(path, h.sub, { ...s, segments: replaceAt(s.segments, h.index, { ...seg, [h.kind]: to }) });
}

/**
 * `path` with a vertex added on segment `index` of subpath `sub` at parameter `t` (0 < t < 1), the curve unchanged: a line is
 * split in two lines, a cubic in the two cubics that draw it. The new vertex is vertex `index + 1`.
 *
 * @public
 */
export function insertPoint(path: EditPath, sub: number, index: number, t: number): EditPath {
  const s = path[sub];
  const seg = s?.segments[index];
  if (s === undefined || seg === undefined) return path;
  const [a, b] = splitAt(segmentCubic(s, index), t);
  const halves: EditSegment[] =
    seg.kind === 'L'
      ? [seg, seg]
      : [
          { kind: 'C', c1: a.p1, c2: a.p2 },
          { kind: 'C', c1: b.p1, c2: b.p2 },
        ];
  const points = [...s.points.slice(0, index + 1), a.p3, ...s.points.slice(index + 1)];
  const segments = [...s.segments.slice(0, index), ...halves, ...s.segments.slice(index + 1)];
  return replaceAt(path, sub, { ...s, points, segments });
}

/**
 * `path` without vertex `index` of subpath `sub`, its two segments joined into one (a line when both were lines, else a cubic
 * keeping the outer handles); an end of an open subpath drops its segment. Undefined when the subpath would have too few
 * vertices left (two open, three closed).
 *
 * @public
 */
export function removePoint(path: EditPath, sub: number, index: number): EditPath | undefined {
  const s = path[sub];
  const n = s?.points.length ?? 0;
  if (s === undefined || index < 0 || index >= n || n <= (s.closed ? 3 : 2)) return undefined;
  const points = s.points.filter((_, k) => k !== index);
  if (!s.closed && (index === 0 || index === n - 1)) {
    const segments = index === 0 ? s.segments.slice(1) : s.segments.slice(0, -1);
    return replaceAt(path, sub, { ...s, points, segments });
  }
  const before = (index + n - 1) % n;
  const [inSeg, outSeg] = [segmentCubic(s, before), segmentCubic(s, index)];
  const straight = s.segments[before]?.kind === 'L' && s.segments[index]?.kind === 'L'; // kind-switch-allow: a path segment's closed kind (L or C)
  const joined: EditSegment = straight ? { kind: 'L' } : { kind: 'C', c1: inSeg.p1, c2: outSeg.p2 };
  // the joined segment takes the place of the one arriving at the removed vertex
  const segments = s.segments.flatMap((seg, k) => (k === index ? [] : k === before ? [joined] : [seg]));
  // removing vertex 0 of a closed subpath: the joined segment, last in the list, runs from the new last vertex to the new first
  return replaceAt(path, sub, { ...s, points, segments });
}

const num = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};
const pt = (p: Vec2, o: Vec2) => `${num(p.x - o.x)} ${num(p.y - o.y)}`;

/**
 * `path` as path data, every coordinate less `origin` and rounded to two decimals.
 *
 * @public
 */
export function writeEditPath(path: EditPath, origin: Vec2 = { x: 0, y: 0 }): string {
  return path
    .map((s) => {
      const parts = [`M ${pt(s.points[0] as Vec2, origin)}`];
      s.segments.forEach((seg, i) => {
        const to = nextOf(s, i);
        // a closed subpath's last line is the Z itself
        if (s.closed && seg.kind === 'L' && i === s.segments.length - 1) return;
        parts.push(seg.kind === 'L' ? `L ${pt(to, origin)}` : `C ${pt(seg.c1, origin)} ${pt(seg.c2, origin)} ${pt(to, origin)}`); // kind-switch-allow: a path segment's closed kind (L or C)
      });
      if (s.closed) parts.push('Z');
      return parts.join(' ');
    })
    .join(' ');
}
