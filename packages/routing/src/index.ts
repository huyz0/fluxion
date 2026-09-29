// Public entry of @fluxion/routing; the package comment is the dts banner in tsdown.config.ts.

export { type AnchorTarget, DEFAULT_ANCHORS, type ResolvedAnchor, resolveAnchor, shapeAnchorTarget } from './anchor.js';
export { type ConnectorRoute, type RouteContext, routeConnector } from './connector-route.js';
export { type RouteEnd, type RouteRequest, type Router, registerBuiltinRouters, straightRouter } from './router.js';

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';
