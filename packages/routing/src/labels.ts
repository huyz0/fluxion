// Placing things along a route (FR-CON-003, FR-CON-006): a label, or a mid marker, sits at a fraction of
// the route's length (arc length, so t 0.5 is the midpoint of the drawn path however its segments are
// split). Both follow the route: placing is a pure function of the route's path.
import { createPathSampler, type PathCommand, pathFromCommands, type Vec2 } from '@fluxion/geometry';

/**
 * A place on a route: a point and the unit direction the route runs there.
 *
 * @public
 */
export type RoutePoint = {
  /** The point. */
  readonly point: Vec2;
  /** The unit tangent, source to target; zero where the route has no direction. */
  readonly dir: Vec2;
};

/**
 * The point at fraction `t` (0: source, 1: target; clamped) of the route `commands`' length and the
 * direction it runs there; the origin with no direction for a route that is not a path.
 *
 * @public
 */
export function routePoint(commands: readonly PathCommand[], t: number): RoutePoint {
  const path = pathFromCommands(commands);
  // a route that is not a path (no commands): nowhere, heading nowhere
  if (!path.ok) return { point: { x: 0, y: 0 }, dir: { x: 0, y: 0 } };
  const sampler = createPathSampler(path.value);
  return { point: sampler.pointAtFraction(t), dir: sampler.tangentAtLength(Math.min(Math.max(t, 0), 1) * sampler.length) };
}

/**
 * Where a label at fraction `t` (0: source, 1: target; clamped) of the route `commands` sits, moved by
 * `offset`; the route's start for a path of no length.
 *
 * @public
 */
export function labelPosition(commands: readonly PathCommand[], t: number, offset: Vec2 = { x: 0, y: 0 }): Vec2 {
  const at = routePoint(commands, t).point;
  return { x: at.x + offset.x, y: at.y + offset.y };
}
