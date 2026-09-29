// Connector label placement (FR-CON-006): a label sits at a fraction of the route's length (arc
// length, so t 0.5 is the midpoint of the drawn path however its segments are split), moved by its
// offset. Labels follow the route: placing is a pure function of the route's path.
import { createPathSampler, type PathCommand, pathFromCommands, type Vec2 } from '@fluxion/geometry';

/**
 * Where a label at fraction `t` (0: source, 1: target; clamped) of the route `commands` sits, moved by
 * `offset`; the route's start for a path of no length.
 *
 * @public
 */
export function labelPosition(commands: readonly PathCommand[], t: number, offset: Vec2 = { x: 0, y: 0 }): Vec2 {
  const path = pathFromCommands(commands);
  // a route that is not a path (no commands): nowhere but the offset
  const at = path.ok ? createPathSampler(path.value).pointAtFraction(t) : { x: 0, y: 0 };
  return { x: at.x + offset.x, y: at.y + offset.y };
}
