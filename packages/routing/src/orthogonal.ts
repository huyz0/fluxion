// The simple `orthogonal` (elbow) router (FR-CON-002; no obstacle avoidance, ADR-0005): axis-aligned
// segments that leave the source along its anchor direction and arrive at the target against its
// direction, each snapped to the nearer axis (an end without one faces the other end). Each end first
// runs a short stub straight out; the stubs join with the first of a few candidate bends (a Z halfway
// along or across, one corner, detours beyond both stubs) whose route never turns straight back on
// itself. Waypoints are passed through with one corner each.
import type { PathCommand, Vec2 } from '@fluxion/geometry';
import type { RouteEnd, Router } from './router.js';

/**
 * How far an orthogonal route runs straight out of an anchor before it turns, px.
 *
 * @public
 */
export const ORTHOGONAL_STUB = 20;

/** `v` snapped to the nearer axis as a unit vector; `fallback` for a zero vector. */
function snap(v: Vec2, fallback: Vec2): Vec2 {
  if (v.x === 0 && v.y === 0) return fallback;
  return Math.abs(v.x) >= Math.abs(v.y) ? { x: Math.sign(v.x), y: 0 } : { x: 0, y: Math.sign(v.y) };
}

/** The axis direction an end leaves along: its anchor direction snapped, else toward `other`. */
const facing = (end: RouteEnd, other: Vec2): Vec2 => snap(end.dir ?? { x: other.x - end.point.x, y: other.y - end.point.y }, { x: 1, y: 0 });

/** One stub out from `p` along `d`. */
const out = (p: Vec2, d: Vec2): Vec2 => ({ x: p.x + d.x * ORTHOGONAL_STUB, y: p.y + d.y * ORTHOGONAL_STUB });

/** The unit axis direction from `a` to `b` (they differ in one coordinate). */
const heading = (a: Vec2, b: Vec2): Vec2 => ({ x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) });

/** `points` without repeats, and without middle points of straight runs that keep their direction. */
function simplify(points: readonly Vec2[]): Vec2[] {
  const kept: Vec2[] = [];
  for (const p of points) {
    const last = kept.at(-1);
    if (last !== undefined && last.x === p.x && last.y === p.y) continue;
    const before = kept.at(-2);
    // before → last → p one way along one axis: last is not a bend
    if (before !== undefined && last !== undefined && heading(before, last).x === heading(last, p).x && heading(before, last).y === heading(last, p).y)
      kept.pop();
    kept.push(p);
  }
  return kept;
}

/** Whether the axis-aligned route `points` never turns straight back on itself. */
function forward(points: readonly Vec2[]): boolean {
  return points.slice(2).every((p, k) => {
    const [d1, d2] = [heading(points[k] as Vec2, points[k + 1] as Vec2), heading(points[k + 1] as Vec2, p)];
    // unit axis directions: opposite ones are the only pair whose dot product is -1
    return d1.x * d2.x + d1.y * d2.y > -1;
  });
}

/**
 * Candidate bends joining stub tip `a` (whose end leaves along `da`) to stub tip `b` (along `db`), in
 * order of preference. Every candidate is a Z: along `da`'s axis to a turning coordinate, across, and
 * along again (`along`), or across first (`across`); a corner is a Z turning at a tip. First the
 * natural shape (for ends on one axis a Z halfway along it, else one corner), then either corner, the
 * halfway Zs, and detours two stubs beyond both tips on each side of each axis (M5.19 review F1).
 */
function candidates(a: Vec2, da: Vec2, b: Vec2, db: Vec2): Vec2[][] {
  const horizontal = da.x !== 0;
  // coordinates on da's axis (along) and across it
  const [aAlong, aAcross, bAlong, bAcross] = horizontal ? [a.x, a.y, b.x, b.y] : [a.y, a.x, b.y, b.x];
  const at = (u: number, v: number): Vec2 => (horizontal ? { x: u, y: v } : { x: v, y: u });
  const along = (u: number): Vec2[] => [at(u, aAcross), at(u, bAcross)];
  const across = (v: number): Vec2[] => [at(aAlong, v), at(bAlong, v)];
  const [midAlong, midAcross] = [(aAlong + bAlong) / 2, (aAcross + bAcross) / 2];
  const reach = 2 * ORTHOGONAL_STUB;
  // ends on one axis: a Z halfway along it first (on different axes the corner below comes first)
  const natural = horizontal === (db.x !== 0) ? [along(midAlong)] : [];
  return [
    ...natural,
    along(bAlong),
    along(aAlong),
    along(midAlong),
    across(midAcross),
    // tzap disable next-line MethodExpression: a detour is reached only when both tips share its coordinate (exhaustive 5 px grid within ±120 px), where min and max coincide
    across(Math.min(aAcross, bAcross) - reach),
    // tzap disable next-line MethodExpression: a detour is reached only when both tips share its coordinate (exhaustive 5 px grid within ±120 px), where min and max coincide
    across(Math.max(aAcross, bAcross) + reach),
    // tzap disable next-line MethodExpression: a detour is reached only when both tips share its coordinate (exhaustive 5 px grid within ±120 px), where min and max coincide
    along(Math.min(aAlong, bAlong) - reach),
    // tzap disable next-line MethodExpression: a detour is reached only when both tips share its coordinate (exhaustive 5 px grid within ±120 px), where min and max coincide
    along(Math.max(aAlong, bAlong) + reach),
  ];
}

/**
 * The `orthogonal` router: axis-aligned segments that leave the source along its anchor direction
 * and arrive at the target against its direction (both snapped to an axis; an end without one faces
 * the other end); waypoints are passed through with one corner each. No obstacle avoidance.
 *
 * @public
 */
export const orthogonalRouter: Router = {
  route: ({ source, target, route }) => {
    const waypoints = route.waypoints ?? [];
    const ds = facing(source, waypoints[0] ?? target.point);
    const dt = facing(target, waypoints.at(-1) ?? source.point);
    const [a, b] = [out(source.point, ds), out(target.point, dt)];
    // through waypoints: a corner before each (horizontal first), then on to the target's stub
    const via = waypoints.flatMap((w, k) => {
      const from = k === 0 ? a : (waypoints[k - 1] as Vec2);
      return [{ x: w.x, y: from.y }, w];
    });
    const last = via.at(-1);
    const joins = last === undefined ? candidates(a, ds, b, dt) : [[{ x: last.x, y: b.y }]];
    const routes = joins.map((join) => simplify([source.point, a, ...via, ...join, b, target.point]));
    const points = routes.find(forward) ?? (routes[0] as Vec2[]);
    return points.map((to, k): PathCommand => ({ kind: k === 0 ? 'M' : 'L', to }));
  },
};
