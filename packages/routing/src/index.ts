// Public entry of @fluxion/routing; the package comment is the dts banner in tsdown.config.ts.

export { type AnchorTarget, DEFAULT_ANCHORS, type ResolvedAnchor, resolveAnchor, shapeAnchorTarget } from './anchor.js';
export { registerBuiltinRouters } from './builtins.js';
export { type ConnectorRoute, type RouteContext, routeConnector } from './connector-route.js';
export { curvedRouter, polylineRouter } from './curved.js';
export { ORTHOGONAL_STUB, orthogonalRouter } from './orthogonal.js';
export { type RouteEnd, type RouteRequest, type Router, straightRouter } from './router.js';

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';
