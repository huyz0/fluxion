// Public entry of @fluxion/routing; the package comment is the dts banner in tsdown.config.ts.

export { type AnchorTarget, DEFAULT_ANCHORS, type ResolvedAnchor, resolveAnchor, shapeAnchorTarget } from './anchor.js';
export { AUTO_WEIGHTS, type AutoChoice, type AutoEdge, type AutoEnd, type AutoOptions, type AutoWeights, chooseAutoSides, type Side } from './auto-anchor.js';
export { registerBuiltinRouters } from './builtins.js';
export { type ConnectorRoute, type RouteContext, routeConnector } from './connector-route.js';
export { curvedRouter, polylineRouter } from './curved.js';
export { distributeSlots, type Slot, type SlotEnd } from './distribution.js';
export {
  GLOBAL_ROUTE_MAX_CONNECTORS,
  type GlobalConnector,
  type GlobalObstacle,
  type GlobalRoute,
  type GlobalRouteInput,
  globalRouteInput,
  globalRoutes,
} from './global.js';
export { affectedConnectors, rerouteAffected } from './incremental.js';
export { createJumpCache, findJumps, hopPath, type Jump, type JumpMap, type JumpRoute, type JumpStyle } from './jumps.js';
export { type LabelPlacement, type LabelRequest, type LabelSize, placeLabels } from './label-placement.js';
export { labelPosition, type RoutePoint, routePoint } from './labels.js';
export { buildGrid, type Grid, type GridInput } from './orthogonal/grid.js';
export { type NudgeRoute, nudge } from './orthogonal/nudge.js';
export { type RouteSegment, type SearchInput, searchRoute } from './orthogonal/search.js';
export { type SimplifyOptions, simplify } from './orthogonal/simplify.js';
export { ORTHOGONAL_STUB, orthogonalRouter } from './orthogonal.js';
export { fanOrthogonal, fanWaypoint, type ParallelEdge, parallelOffsets } from './parallel.js';
export { type RouteEnd, type RouteQuality, type RouteRequest, type Router, straightRouter } from './router.js';
export { type TrimmedRoute, trimRoute } from './trim.js';

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';
