// Trimming a route under its end markers (FR-CON-003): the first and last segments are shortened so
// that a marker drawn at the new end reaches the old one with its tip. A marker is straight, so a trim
// is a straight distance: a line is shortened along itself; a curve is cut (de Casteljau) where it
// comes that close to its end, and the cut end's tangent is turned toward the old end, along which the
// marker is drawn (M5.20 review F2). Each trim takes at most half its segment's span, so the segment
// keeps a direction to orient the marker by (M5.20 review F1).
import { type CubicSegment, lerp, type PathCommand, pointAt, splitAt, type Vec2 } from '@fluxion/geometry';

/** Bisection steps when finding a curve's cut (2^-40 of the curve: far below a pixel). */
const STEPS = 40;

const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/** The drawing command `cmd` from `from` as a cubic, or null for a line (or anything but a curve). */
function cubicOf(from: Vec2, cmd: PathCommand): CubicSegment | null {
  if (cmd.kind === 'C') return { p0: from, p1: cmd.control1, p2: cmd.control2, p3: cmd.to }; // kind-switch-allow: a path command's closed union (geometry), not an element kind
  // a quadratic raised to a cubic
  if (cmd.kind === 'Q') return { p0: from, p1: lerp(from, cmd.control, 2 / 3), p2: lerp(cmd.to, cmd.control, 2 / 3), p3: cmd.to }; // kind-switch-allow: a path command's closed union (geometry), not an element kind
  return null;
}

/**
 * The parameter between `inside` (where `seg` is less than `cut` from `anchor`) and `outside` (where it
 * is at least that far) at which it is `cut` from `anchor`, found by bisection.
 */
function cutAt(seg: CubicSegment, anchor: Vec2, span: { inside: number; outside: number }, cut: number): number {
  let { inside, outside } = span;
  // tzap disable next-line EqualityOperator: one more halving only sharpens a parameter already far below a pixel
  for (let k = 0; k < STEPS; k++) {
    const mid = (inside + outside) / 2;
    // tzap disable next-line EqualityOperator: at an exact tie either half holds the cut
    if (distance(pointAt(seg, mid), anchor) < cut) inside = mid;
    else outside = mid;
  }
  return outside;
}

/** `handle` moved onto the ray from `at` away from `toward`, as far from `at` as it was. */
function aimed(at: Vec2, handle: Vec2, toward: Vec2): Vec2 {
  const reach = distance(handle, at);
  const d = distance(toward, at);
  return { x: at.x - ((toward.x - at.x) / d) * reach, y: at.y - ((toward.y - at.y) / d) * reach };
}

/** One segment after trimming: its new start, its command and what each end lost. */
type Trimmed = { readonly from: Vec2; readonly cmd: PathCommand; readonly start: number; readonly end: number };

/** The line from `from` to `to` with its end brought up to `end` and then its start up to `start` closer (each at most half its span). */
function trimLine(from: Vec2, to: Vec2, start: number, end: number): Trimmed {
  const span = distance(from, to);
  const endCut = Math.min(end, span / 2);
  const last = endCut > 0 ? lerp(to, from, endCut / span) : to;
  const startCut = Math.min(start, distance(from, last) / 2);
  const first = startCut > 0 ? lerp(from, last, startCut / distance(from, last)) : from;
  return { from: first, cmd: { kind: 'L', to: last }, start: startCut, end: endCut };
}

/** The curve `seg` cut `end` from its end and then `start` from its start (each at most half its span), its cut ends aimed at the old ones. */
function trimCurve(seg: CubicSegment, start: number, end: number): Trimmed {
  const endCut = Math.min(end, distance(seg.p0, seg.p3) / 2);
  // tzap disable next-line ConditionalExpression,EqualityOperator: cutting nothing bisects to the end itself
  const t1 = endCut > 0 ? cutAt(seg, seg.p3, { inside: 1, outside: 0 }, endCut) : 1;
  const startCut = Math.min(start, distance(seg.p0, pointAt(seg, t1)) / 2);
  // tzap disable next-line ConditionalExpression,EqualityOperator: cutting nothing bisects to the start itself
  const t0 = startCut > 0 ? cutAt(seg, seg.p0, { inside: 0, outside: t1 }, startCut) : 0;
  // the piece between t0 and t1, both found on the original curve (t1 > 0: an end cut takes at most half the span)
  const [head] = splitAt(seg, t1);
  const [, piece] = splitAt(head, t0 / t1);
  // a cut end leaves toward the old end, along which the marker reaches it
  const p2 = endCut > 0 ? aimed(piece.p3, piece.p2, seg.p3) : piece.p2;
  const p1 = startCut > 0 ? aimed(piece.p0, piece.p1, seg.p0) : piece.p1;
  return { from: piece.p0, cmd: { kind: 'C', control1: p1, control2: p2, to: piece.p3 }, start: startCut, end: endCut };
}

/** The segment from `from` along `cmd` trimmed by up to `start` and `end`: unchanged when neither applies. */
function trimSegment(from: Vec2, cmd: PathCommand, start: number, end: number): Trimmed {
  if (start <= 0 && end <= 0) return { from, cmd, start: 0, end: 0 };
  const seg = cubicOf(from, cmd);
  return seg === null ? trimLine(from, (cmd as { to: Vec2 }).to, start, end) : trimCurve(seg, start, end);
}

/**
 * A trimmed route and how much was taken off each end, px.
 *
 * @public
 */
export type TrimmedRoute = {
  /** The route, shortened. */
  readonly commands: readonly PathCommand[];
  /** Taken off the start: the straight distance from the old start to the new one. */
  readonly start: number;
  /** Taken off the end: the straight distance from the new end to the old one. */
  readonly end: number;
};

/**
 * The route `commands` (a move, then lines and curves) with its first segment's start brought up to
 * `start` px (a straight distance) closer to its end, and its last segment's end `end` px closer to its
 * start. A trim takes at most half the span between its segment's ends, so the segment keeps its
 * direction; a cut curve's end tangent points at the old end, so a marker drawn along it from the new
 * end reaches the old one (M5.20 review F1, F2). The result says how much each end lost. Routes with
 * no segment are returned as they are.
 *
 * @public
 */
export function trimRoute(commands: readonly PathCommand[], start: number, end: number): TrimmedRoute {
  const move = commands[0];
  if (move?.kind !== 'M' || commands.length < 2) return { commands, start: 0, end: 0 };
  const out = [...commands];
  const last = out.length - 1;
  // one segment is trimmed at both ends at once; otherwise the last at its end, then the first at its start
  const tail = trimSegment(last === 1 ? move.to : (out[last - 1] as { to: Vec2 }).to, out[last] as PathCommand, last === 1 ? start : 0, end);
  out[last] = tail.cmd;
  const head = last === 1 ? tail : trimSegment(move.to, out[1] as PathCommand, start, 0);
  out[0] = { kind: 'M', to: head.from };
  out[1] = head.cmd;
  return { commands: out, start: head.start, end: tail.end };
}
