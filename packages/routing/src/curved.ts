// The `curved` and `polyline` routers (FR-CON-002). A curved route is a cubic that leaves each end
// along its anchor's outward direction (toward the other end when the anchor has none); through
// waypoints it is a chain of cubics with Catmull-Rom tangents inside. A polyline is straight lines
// through the waypoints.
import { add, normalize, type PathCommand, scale, sub, type Vec2 } from '@fluxion/geometry';
import type { RouteEnd, Router } from './router.js';

/** The end's outward direction, or the unit direction toward `next` (none when they coincide). */
const outward = (end: RouteEnd, next: Vec2): Vec2 => end.dir ?? normalize(sub(next, end.point));

/**
 * The `curved` router: one cubic per leg between the ends and the waypoints. The first leg leaves the
 * source along its anchor direction and the last arrives at the target against its anchor direction,
 * their control points a third of the leg's length out; tangents at waypoints are Catmull-Rom's. A `route.tangents` entry replaces the control
 * point of its route point (ADR-0168).
 *
 * @public
 */
export const curvedRouter: Router = {
  describe: 'A smooth curve that leaves and enters each end along its side.',
  route: ({ source, target, route }) => {
    const points = [source.point, ...(route.waypoints ?? []), target.point];
    const last = points.length - 1;
    // the tangent at point k, scaled to its legs: the end directions at the ends, Catmull-Rom inside
    const tangent = (k: number): Vec2 => {
      if (k === 0) return outward(source, points[1] as Vec2);
      if (k === last) return scale(outward(target, points[last - 1] as Vec2), -1);
      return normalize(sub(points[k + 1] as Vec2, points[k - 1] as Vec2));
    };
    // the author's offset from point k to its control point (ADR-0168): the source and a waypoint leave by it, the target arrives by it, and a waypoint is arrived at against it
    const set = (k: number): Vec2 | undefined => route.tangents?.[String(k)];
    const legs = points.slice(1).map((to, k): PathCommand => {
      const from = points[k] as Vec2;
      const reach = Math.hypot(to.x - from.x, to.y - from.y) / 3;
      const out = set(k);
      const into = set(k + 1);
      return {
        kind: 'C',
        control1: out === undefined ? add(from, scale(tangent(k), reach)) : add(from, out),
        control2: into === undefined ? add(to, scale(tangent(k + 1), -reach)) : k + 1 === last ? add(to, into) : sub(to, into),
        to,
      };
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
  describe: 'Straight segments through the waypoints the author set.',
  route: ({ source, target, route }) => [
    { kind: 'M', to: source.point },
    ...[...(route.waypoints ?? []), target.point].map((to): PathCommand => ({ kind: 'L', to })),
  ],
};
