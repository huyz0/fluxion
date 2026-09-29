// Routers (FR-RTE-001): a router turns a connector's two resolved ends into a path. Routers are
// looked up by the route's type in a `routers` registry (the host's core registry, where packs
// register theirs as `<namespace>:<name>`); the built-ins register there under source `core`
// (builtins.ts).
import type { PathCommand, Vec2 } from '@fluxion/geometry';
import type { Route } from '@fluxion/schema';

/**
 * One resolved end of a connector.
 *
 * @public
 */
export type RouteEnd = {
  /** Where the end attaches, screen coordinates. */
  readonly point: Vec2;
  /** Unit direction the route leaves along; absent when the anchor has none. */
  readonly dir?: Vec2 | undefined;
};

/**
 * What a router routes: the resolved ends and the connector's route intent (type, waypoints, …).
 *
 * @public
 */
export type RouteRequest = {
  /** The source end. */
  readonly source: RouteEnd;
  /** The target end. */
  readonly target: RouteEnd;
  /** The connector's route. */
  readonly route: Route;
};

/**
 * A router (FR-RTE-001): absolute path commands from the source point to the target point, starting
 * with a move to the source. Must be pure: the same request gives the same path.
 *
 * @public
 */
export type Router = {
  /** The path of `request`. */
  route(request: RouteRequest): readonly PathCommand[];
};

/**
 * The `straight` router: one line from end to end.
 *
 * @public
 */
export const straightRouter: Router = {
  route: ({ source, target }) => [
    { kind: 'M', to: source.point },
    { kind: 'L', to: target.point },
  ],
};
