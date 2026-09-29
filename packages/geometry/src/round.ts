// Rounded corners (ADR-0019, FR-SHP-004, FR-CON-005): each corner between two straight segments of a
// path becomes a circular arc (one cubic) tangent to both, its tangent points at most halfway along
// each segment; curves and straight-through joins stay as they are.
import type { PathCommand } from './path.js';
import type { Vec2 } from './vec2.js';

type Segment = { readonly line: boolean; readonly from: Vec2; readonly to: Vec2; readonly cmd: PathCommand };

/** A corner's fillet: the tangent points on the incoming and outgoing segments and the arc between. */
type Fillet = { readonly enter: Vec2; readonly leave: Vec2; readonly arc: PathCommand };

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const along = (p: Vec2, d: Vec2, t: number): Vec2 => ({ x: p.x + d.x * t, y: p.y + d.y * t });
const len = (v: Vec2) => Math.hypot(v.x, v.y);
const endOf = (cmd: PathCommand, fallback: Vec2): Vec2 => ('to' in cmd ? cmd.to : fallback);

/** The segments of `cmds` (one subpath; `Z` closes with a line when the pen is away from the start). */
function segments(cmds: readonly PathCommand[]): { readonly list: Segment[]; readonly start: Vec2; readonly closed: boolean } {
  const start = endOf(cmds[0] as PathCommand, { x: 0, y: 0 });
  const list: Segment[] = [];
  let pen = start;
  const z = cmds.findIndex((c) => c.kind === 'Z');
  // tzap disable next-line EqualityOperator: Z is never at 0, where the M is
  for (const cmd of cmds.slice(1, z < 0 ? undefined : z)) {
    const to = endOf(cmd, pen);
    list.push({ line: cmd.kind === 'L', from: pen, to, cmd });
    pen = to;
  }
  // Z closes with a line when the pen is away from the start
  const away = pen.x !== start.x || pen.y !== start.y;
  // tzap disable next-line EqualityOperator: Z is never at 0, where the M is
  if (z >= 0 && away) list.push({ line: true, from: pen, to: start, cmd: { kind: 'L', to: start } });
  // tzap disable next-line EqualityOperator: Z is never at 0, where the M is
  return { list, start, closed: z >= 0 };
}

/** The fillet at the corner where straight `a` meets straight `b`, or null for a straight-through join. */
function fillet(a: Segment, b: Segment, radius: number): Fillet | null {
  const [la, lb] = [len(sub(a.to, a.from)), len(sub(b.to, b.from))];
  if (la === 0 || lb === 0) return null;
  const back = { x: (a.from.x - a.to.x) / la, y: (a.from.y - a.to.y) / la };
  const ahead = { x: (b.to.x - b.from.x) / lb, y: (b.to.y - b.from.y) / lb };
  // the angle at the corner between the two segments, 0 … π (π: straight on)
  const phi = Math.acos(Math.max(-1, Math.min(1, back.x * ahead.x + back.y * ahead.y)));
  // tzap disable next-line EqualityOperator: an angle of exactly 1e-9 is not observable
  if (phi < 1e-9 || Math.PI - phi < 1e-9) return null;
  const d = Math.min(radius / Math.tan(phi / 2), la / 2, lb / 2);
  const r = d * Math.tan(phi / 2);
  // one cubic for the arc's sweep, π - φ
  const k = (4 / 3) * Math.tan((Math.PI - phi) / 4) * r;
  const corner = a.to;
  const enter = along(corner, back, d);
  const leave = along(corner, ahead, d);
  return { enter, leave, arc: { kind: 'C', control1: along(enter, back, -k), control2: along(leave, ahead, -k), to: leave } };
}

/** The fillet after each segment (the last only when closed: it is the start's), or null where none. */
function cornersOf(list: readonly Segment[], closed: boolean, radius: number): (Fillet | null)[] {
  const n = list.length;
  return list.map((a, k) => {
    const b = list[(k + 1) % n] as Segment;
    const inner = k < n - 1 || closed;
    return inner && a.line && b.line ? fillet(a, b, radius) : null;
  });
}

/**
 * `cmds` (one subpath of M, L, Q, C and Z, as geometry's path commands) with every corner between two
 * straight segments rounded to `radius` (at most half of each segment's length). A radius of 0 or less
 * returns the commands unchanged.
 *
 * @public
 */
export function roundCorners(cmds: readonly PathCommand[], radius: number): readonly PathCommand[] {
  if (!(radius > 0) || cmds[0]?.kind !== 'M') return cmds;
  const { list, start, closed } = segments(cmds);
  const corners = cornersOf(list, closed, radius);
  // a closed path starts after its start corner's arc
  const first = closed ? corners.at(-1)?.leave : undefined;
  const body = list.flatMap((seg, k): PathCommand[] => {
    const corner = corners[k] ?? null;
    const drawn: PathCommand = seg.line ? { kind: 'L', to: corner?.enter ?? seg.to } : seg.cmd;
    return corner === null ? [drawn] : [drawn, corner.arc];
  });
  return [{ kind: 'M', to: first ?? start }, ...body, ...(closed ? [{ kind: 'Z' } as const] : [])];
}
