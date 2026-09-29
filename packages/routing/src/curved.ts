// The `curved` and `polyline` routers (FR-CON-002). A curved route is a cubic that leaves each end
// along its anchor's outward direction (toward the other end when the anchor has none); through
// waypoints it is a chain of cubics with Catmull-Rom tangents inside. A polyline is straight lines
// through the waypoints.
import type { PathCommand, Vec2 } from '@fluxion/geometry';
import type { RouteEnd, Router } from './router.js';

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const along = (p: Vec2, d: Vec2, k: number): Vec2 => ({ x: p.x + d.x * k, y: p.y + d.y * k });
const unit = (v: Vec2): Vec2 | undefined => {
  const n = Math.hypot(v.x, v.y);
  return n > 0 ? { x: v.x / n, y: v.y / n } : undefined;
};

/** The end's outward direction, or the unit direction toward `next` (none when they coincide). */
const outward = (end: RouteEnd, next: Vec2): Vec2 => end.dir ?? unit(sub(next, end.point)) ?? { x: 0, y: 0 };

/**
 * The `curved` router: one cubic per leg between the ends and the waypoints. The first leg leaves the
 * source along its anchor direction and the last arrives at the target against its anchor direction,
 * their control points a third of the leg's length out; tangents at waypoints are Catmull-Rom's.
 *
 * @public
 */
export const curvedRouter: Router = {
  route: ({ source, target, route }) => {
    const points = [source.point, ...(route.waypoints ?? []), target.point];
    const last = points.length - 1;
    // the tangent at point k, scaled to its legs: the end directions at the ends, Catmull-Rom inside
    const tangent = (k: number): Vec2 => {
      if (k === 0) return outward(source, points[1] as Vec2);
      if (k === last) return along({ x: 0, y: 0 }, outward(target, points[last - 1] as Vec2), -1);
      return unit(sub(points[k + 1] as Vec2, points[k - 1] as Vec2)) ?? { x: 0, y: 0 };
    };
    const legs = points.slice(1).map((to, k): PathCommand => {
      const from = points[k] as Vec2;
      const reach = Math.hypot(to.x - from.x, to.y - from.y) / 3;
      return { kind: 'C', control1: along(from, tangent(k), reach), control2: along(to, tangent(k + 1), -reach), to };
    });
    return [{ kind: 'M', to: source.point }, ...legs];
  },
};

/**
 * The `polyline` router: straight lines from the source through each waypoint to the target.
 *
 * @public
 */
export const polylineRouter: Router = {
  route: ({ source, target, route }) => [
    { kind: 'M', to: source.point },
    ...[...(route.waypoints ?? []), target.point].map((to): PathCommand => ({ kind: 'L', to })),
  ],
};
