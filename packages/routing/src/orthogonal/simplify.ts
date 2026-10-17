// Clean-up of an orthogonal route (ADR-0042, FR-RTE-003): drop points on a straight run, then merge the small jogs the grid leaves.
// The two ends of a route never move and its first and last segments (the stubs) are never made shorter than `minStub`.
import type { Vec2 } from '@fluxion/geometry';

/**
 * What `simplify` keeps.
 *
 * @public
 */
export type SimplifyOptions = {
  /** A jog (a short segment between two parallel ones) shorter than this is merged away, px. Default 4. */
  readonly minJog?: number | undefined;
  /** The first and last segments keep at least this length, or what they had if shorter, px. Default 12. */
  readonly minStub?: number | undefined;
};

const length = (a: Vec2, b: Vec2): number => Math.abs(b.x - a.x) + Math.abs(b.y - a.y);

/** `path` without repeated points and without points on a straight run between their neighbours. */
function dropCollinear(path: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of path) {
    const last = out[out.length - 1];
    if (last === undefined || last.x !== p.x || last.y !== p.y) out.push(p);
  }
  return out.filter((p, k) => {
    const a = out[k - 1];
    const b = out[k + 1];
    return a === undefined || b === undefined || !((a.x === p.x && p.x === b.x) || (a.y === p.y && p.y === b.y));
  });
}

/** `path` with segment `k` (points k and k+1) moved onto the line of segment `to` (points to and to+1). */
function align(path: readonly Vec2[], k: number, to: number): Vec2[] {
  const target = path[to] as Vec2;
  const horizontal = (path[k] as Vec2).y === (path[k + 1] as Vec2).y;
  return path.map((p, i) => (i === k || i === k + 1 ? (horizontal ? { x: p.x, y: target.y } : { x: target.x, y: p.y }) : p));
}

/** Whether the ends of `after` keep a stub of at least `minStub` (or what `before` had). */
function stubsKept(before: readonly Vec2[], after: readonly Vec2[], minStub: number): boolean {
  const first = (p: readonly Vec2[]): number => length(p[0] as Vec2, p[1] as Vec2);
  const last = (p: readonly Vec2[]): number => length(p[p.length - 2] as Vec2, p[p.length - 1] as Vec2);
  return first(after) >= Math.min(minStub, first(before)) && last(after) >= Math.min(minStub, last(before));
}

/** The ways to merge the jog at points k+1 and k+2: the segment before moves onto the one after, or the reverse; an end segment never moves. */
function jogMoves(count: number, k: number): Array<readonly [number, number]> {
  const moves: Array<readonly [number, number]> = [];
  if (k > 0) moves.push([k, k + 2]);
  if (k + 4 < count) moves.push([k + 2, k]);
  return moves;
}

/** One merge of a jog, or undefined when there is none to merge. */
function mergeJog(path: readonly Vec2[], minJog: number, minStub: number): Vec2[] | undefined {
  for (let k = 0; k + 3 < path.length; k++) {
    if (length(path[k + 1] as Vec2, path[k + 2] as Vec2) >= minJog) continue;
    for (const [move, to] of jogMoves(path.length, k)) {
      const moved = align(path, move, to);
      if (stubsKept(path, moved, minStub)) return moved;
    }
  }
  return undefined;
}

/**
 * `path` with collinear points dropped and jogs shorter than `minJog` merged, ends and stubs kept.
 *
 * @public
 */
export function simplify(path: readonly Vec2[], options: SimplifyOptions = {}): Vec2[] {
  const minJog = options.minJog ?? 4;
  const minStub = options.minStub ?? 12;
  let current = dropCollinear(path);
  for (let guard = 0; guard < path.length; guard++) {
    const next = mergeJog(current, minJog, minStub);
    if (next === undefined) break;
    current = dropCollinear(next);
  }
  return current;
}
