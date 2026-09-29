// A connector's route from its records (FR-CON-001, FR-RTE-001): each end is bound through a
// `binding` record (resolved with its anchor on the bound element) or free at a stored point; the
// router registered for the route's type draws the path between them. A floating end aims at the
// other end's reference point (a bound element's centre, a free point) or at the nearest waypoint.
// Reads records through a ReadView, so a store query over it re-routes when a bound element changes.
import type { ReadView, Registry, ShapeDef } from '@fluxion/core';
import type { PathCommand, Vec2 } from '@fluxion/geometry';
import type { AnchorDef, AnchorRef, RecordId, Route, Transform } from '@fluxion/schema';
import { type AnchorTarget, resolveAnchor, shapeAnchorTarget } from './anchor.js';
import { type RouteEnd, type Router, straightRouter } from './router.js';

/**
 * Where connectors look up what they route with: shape definitions (for outlines and anchors) and
 * routers, each by id.
 *
 * @public
 */
export type RouteContext = {
  /** Shape definitions by id. */
  readonly shapeDefs: Registry<string, ShapeDef>;
  /** Routers by route type. */
  readonly routers: Registry<string, Router>;
};

/**
 * A routed connector: its resolved ends and the path between them.
 *
 * @public
 */
export type ConnectorRoute = {
  /** The source end. */
  readonly source: RouteEnd;
  /** The target end. */
  readonly target: RouteEnd;
  /** Absolute path commands, from the source point to the target point. */
  readonly commands: readonly PathCommand[];
};

type End = 'source' | 'target';
type BindingLike = {
  readonly type?: unknown;
  readonly connectorId?: unknown;
  readonly end?: unknown;
  readonly elementId?: unknown;
  readonly anchor?: AnchorRef;
};
type Bound = {
  readonly transform?: Transform;
  readonly kind?: unknown;
  readonly defId?: string;
  readonly params?: { readonly [key: string]: unknown };
  readonly anchors?: readonly AnchorDef[];
};
type ConnectorLike = { readonly route?: Route; readonly freeSource?: Vec2; readonly freeTarget?: Vec2 };

/** One end before its anchor is resolved: a bound element with its anchor, or a free point. */
type Pending = { readonly target: AnchorTarget; readonly anchor: AnchorRef; readonly at: Vec2 } | { readonly at: Vec2 };

/** One end of a connector: its id, which end, and its free point. */
type EndOf = { readonly connectorId: RecordId; readonly end: End; readonly free: Vec2 | undefined };

/** The end `end` of `connectorId`: bound, free, or undefined when it can be placed from neither. */
function pending(view: ReadView, ctx: RouteContext, { connectorId, end, free }: EndOf): Pending | undefined {
  const binding = view
    .members('bindingsByElement', connectorId)
    .map((id) => view.get(id) as BindingLike | undefined)
    .find((b) => b?.type === 'binding' && b.connectorId === connectorId && b.end === end);
  if (binding === undefined) return free === undefined ? undefined : { at: free };
  const bound = view.get(binding.elementId as RecordId) as Bound | undefined;
  // bound to an element without a box (or a missing one): the end cannot be placed
  if (bound?.transform === undefined) return undefined;
  const t = bound.transform;
  const def = bound.kind === 'shape' && bound.defId !== undefined ? ctx.shapeDefs.get(bound.defId) : undefined;
  return {
    target: shapeAnchorTarget(t, def, bound),
    anchor: binding.anchor ?? { kind: 'floating' },
    // the centre is where rotation and flips turn about: it does not move with them
    at: { x: t.x + t.w / 2, y: t.y + t.h / 2 },
  };
}

/** The end resolved, aiming at `toward`. */
const resolved = (p: Pending, toward: Vec2): RouteEnd => ('target' in p ? resolveAnchor(p.target, p.anchor, toward) : { point: p.at });

/** `router`'s path, or a straight line when it throws or does not start at the source. */
function pathOf(router: Router, source: RouteEnd, target: RouteEnd, route: Route): readonly PathCommand[] {
  try {
    const commands = router.route({ source, target, route });
    const first = commands[0];
    // a path must start at the source point: one that starts elsewhere would look detached (M5.17 review F1)
    if (first?.kind === 'M' && first.to.x === source.point.x && first.to.y === source.point.y) return commands;
  } catch {
    // a plugin router's failure draws the connector straight rather than not at all
  }
  return straightRouter.route({ source, target, route });
}

/**
 * The route of connector `connectorId`: its ends resolved through their bindings and anchors (or its
 * free points), routed by the router registered for its route type. An unregistered type, or a
 * router that fails, draws straight. Undefined when an end can be placed neither from a binding nor
 * from a free point.
 *
 * @public
 */
export function routeConnector(view: ReadView, ctx: RouteContext, connectorId: RecordId): ConnectorRoute | undefined {
  const connector = view.get(connectorId) as ConnectorLike | undefined;
  if (connector === undefined) return undefined;
  const from = pending(view, ctx, { connectorId, end: 'source', free: connector.freeSource });
  const to = pending(view, ctx, { connectorId, end: 'target', free: connector.freeTarget });
  if (from === undefined || to === undefined) return undefined;
  const route = connector.route ?? { type: 'straight' };
  const waypoints = route.waypoints ?? [];
  const source = resolved(from, waypoints[0] ?? to.at);
  const target = resolved(to, waypoints.at(-1) ?? from.at);
  const router = ctx.routers.get(route.type) ?? straightRouter;
  return { source, target, commands: pathOf(router, source, target, route) };
}
