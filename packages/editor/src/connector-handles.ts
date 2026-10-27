// Connector handles (FR-CON-007, M7.18-19): where the ends, the waypoints, the middles and (orthogonal) the
// segments of the selected connector's route are, which one a press is on, and the writes a drag makes. An end
// dragged onto an element binds there, at the anchor of the element nearest the drop (a free end dropped on
// nothing moves to the drop; a bound one dropped on nothing stays); a middle dragged out becomes a waypoint; a
// waypoint moves (on a curved route it is the point the curve is pulled through, its control); an orthogonal
// segment dragged across its direction moves the waypoint the route turns at. Pure: the select tool and the
// overlay only call these.
import type { ReadView, ShapeDef } from '@fluxion/core';
import type { PathCommand, Vec2 } from '@fluxion/geometry';
import { type RouteContext, routeConnector, routerBase } from '@fluxion/routing';
import type { ConnectorElement, RecordId, ShapeElement } from '@fluxion/schema';
import { snapAnchor } from './anchor-snap.js';
import type { ParamCommand } from './param-handles.js';

/**
 * A handle of a connector's route.
 *
 * @public
 */
export type ConnectorHandle = {
  /**
   * `end`: an end of the route; `way`: a waypoint; `mid`: the middle of a stretch of it, which becomes a waypoint when
   * dragged; `seg`: a segment of an orthogonal route, dragged across its direction; `tan`: the control point of a route point
   * of a curved route (ADR-0168).
   */
  readonly role: 'end' | 'way' | 'mid' | 'seg' | 'tan';
  /**
   * For an end, which; for a waypoint, its index; for a middle, the index its waypoint would have; for a segment, its index in the route;
   * for a tangent, the index of its point in the list source, waypoints, target.
   */
  readonly at: 'source' | 'target' | number;
  /** Where it is, page units. */
  readonly page: Vec2;
  /** For a segment, the coordinate a drag changes: `x` for a vertical segment, `y` for a horizontal one. */
  readonly axis?: 'x' | 'y';
  /** For a tangent, the route point it belongs to, page units: the handle is dragged relative to it. */
  readonly from?: Vec2;
};

/**
 * The route of a connector as the editor reads it: its end points and the line between, page units.
 *
 * @public
 */
export type RouteReader = (id: RecordId) => RoutedEnds | undefined;

/**
 * The resolved ends of a routed connector (what the handles need of `routeConnector`).
 *
 * @public
 */
export type RoutedEnds = {
  /** The source end. */
  readonly source: RoutedEnd;
  /** The target end. */
  readonly target: RoutedEnd;
  /** The route's path, page units. */
  readonly commands: readonly PathCommand[];
  /** The built-in router that lays the route, when its type is not one (a pack connector type, FR-CON-010); else its type. */
  readonly base?: string;
};

/**
 * One resolved end of a route.
 *
 * @public
 */
export type RoutedEnd = {
  /** Where it attaches, page units. */
  readonly point: Vec2;
};

/** The connector `id`, when it is one. */
function connectorOf(view: ReadView, id: RecordId): ConnectorElement | undefined {
  const record = view.get(id) as ConnectorElement | undefined;
  return record?.type === 'element' && record.kind === 'connector' ? record : undefined;
}

/** The routes of `view`'s connectors routed with `ctx`, each with the built-in router that lays it. */
export function readRoutes(view: ReadView, ctx: RouteContext): RouteReader {
  return (id) => {
    const routed = routeConnector(view, ctx, id);
    const type = connectorOf(view, id)?.route.type;
    return routed === undefined || type === undefined ? routed : { ...routed, base: routerBase(ctx.routers, type) };
  };
}

const middle = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * The handles of the connector `id`: its two ends, and the middle of each stretch between its ends and waypoints.
 * None for anything that is not a connector or cannot be routed.
 *
 * @public
 */
export function connectorHandlesOf(view: ReadView, route: RouteReader, id: RecordId): readonly ConnectorHandle[] {
  const connector = connectorOf(view, id);
  const routed = connector === undefined ? undefined : route(id);
  if (connector === undefined || routed === undefined) return [];
  const waypoints = connector.route.waypoints ?? [];
  const nodes = [routed.source.point, ...waypoints, routed.target.point];
  const mids = nodes.slice(1).map((to, k): ConnectorHandle => ({ role: 'mid', at: k, page: middle(nodes[k] as Vec2, to) }));
  const ways = waypoints.map((page, at): ConnectorHandle => ({ role: 'way', at, page }));
  // a pack connector type is handled as the router that lays it
  const base = routed.base ?? connector.route.type;
  return [
    ...tangentsOf(base, routed.commands),
    { role: 'end', at: 'source', page: routed.source.point },
    { role: 'end', at: 'target', page: routed.target.point },
    ...ways,
    // an orthogonal route is dragged by its segments, whose middles are not the stretches' middles
    ...(base === 'orthogonal' ? segmentsOf(routed.commands) : mids),
  ];
}

/**
 * The control point of each route point of a connector laid by the curved router (`base`), from its path (a cubic per leg): where the first leg leaves the source, where a
 * leg leaves each waypoint, and where the last arrives at the target.
 */
function tangentsOf(base: string, commands: readonly PathCommand[]): readonly ConnectorHandle[] {
  if (base !== 'curved') return [];
  const legs = commands.filter((c): c is Extract<PathCommand, { kind: 'C' }> => c.kind === 'C');
  const points = commands.flatMap((c) => ('to' in c ? [c.to] : []));
  return [...legs.map((c) => c.control1), legs.at(-1)?.control2].flatMap((page, at): ConnectorHandle[] =>
    page === undefined || points[at] === undefined ? [] : [{ role: 'tan', at, page, from: points[at] }],
  );
}

/** The segments of an orthogonal path between its first and last (the stubs out of the anchors), each with its middle. */
function segmentsOf(commands: readonly PathCommand[]): readonly ConnectorHandle[] {
  const points = commands.flatMap((c) => ('to' in c ? [c.to] : []));
  return points.slice(1, -2).flatMap((from, k): ConnectorHandle[] => {
    const at = k + 1;
    const to = points[at + 1] as Vec2;
    return from.x === to.x && from.y === to.y ? [] : [{ role: 'seg', at, page: middle(from, to), axis: from.x === to.x ? 'x' : 'y' }];
  });
}

/** How far ahead of the others a kind of handle is picked: ends, then waypoints, then the rest. */
const RANK = { end: 0, way: 1, tan: 1, mid: 2, seg: 2 } as const;

/**
 * The handle of `handles` nearest page point `p` within `reach` page units; an end wins a tie with a middle (a
 * short stretch has its middle near its end).
 *
 * @public
 */
export function connectorHandleAt(handles: readonly ConnectorHandle[], p: Vec2, reach: number): ConnectorHandle | undefined {
  let best: ConnectorHandle | undefined;
  let bestDistance = reach;
  for (const h of handles) {
    const d = Math.hypot(h.page.x - p.x, h.page.y - p.y);
    // within reach, nearest first; at an equal distance an end sits ahead of a waypoint and that of a middle
    if (d < bestDistance || (d === bestDistance && (best === undefined || RANK[h.role] < RANK[best.role]))) {
      best = h;
      bestDistance = d;
    }
  }
  return best;
}

/** What the drag of a handle edits: the route as it was when the drag began. */
type Original = ConnectorElement['route'];

/** The route with `waypoints`, a straight one becoming a polyline (the router that goes through its waypoints). */
const withWaypoints = (original: Original, waypoints: readonly Vec2[]): Original => ({
  ...original,
  type: original.type === 'straight' ? 'polyline' : original.type,
  waypoints,
});

/** The route with the tangent of route point `index` set to `offset` (ADR-0168). */
const withTangent = (original: Original, index: number, offset: Vec2): Original => ({
  ...original,
  tangents: { ...original.tangents, [String(index)]: offset },
});

/** The route with `waypoints`, one of them new at `index`: the tangents of the route points after it (it is point index + 1) move up one place with them. */
function withNewWaypoint(original: Original, waypoints: readonly Vec2[], index: number): Original {
  const route = withWaypoints(original, waypoints);
  if (original.tangents === undefined) return route;
  return { ...route, tangents: Object.fromEntries(Object.entries(original.tangents).map(([k, v]) => [Number(k) > index ? String(Number(k) + 1) : k, v])) };
}

const update = (id: RecordId, route: Original): ParamCommand => ({ id: 'element.update', args: { id, fields: { route } } });

/**
 * The command that makes a waypoint at page point `p` in the stretch `index` of the connector `id`, from the
 * connector as it was (`original`: its route when the drag began), so the same drag gives the same route each
 * frame. A straight route becomes a polyline, the router that goes through its waypoints.
 *
 * @public
 */
export function waypointEdit(id: RecordId, original: ConnectorElement['route'], index: number, p: Vec2): ParamCommand {
  const waypoints = [...(original.waypoints ?? [])];
  waypoints.splice(index, 0, p);
  return update(id, withNewWaypoint(original, waypoints, index));
}

/** The index of the point of `points` nearest `p` (0 for none). */
const nearestTo = (points: readonly Vec2[], p: Vec2): number =>
  points.reduce((best, c, i) => (Math.hypot(c.x - p.x, c.y - p.y) < Math.hypot((points[best] as Vec2).x - p.x, (points[best] as Vec2).y - p.y) ? i : best), 0);

/**
 * The command that drags the handle `handle` of the connector `id` to page point `p`, from the route as it was when the
 * drag began: a middle makes a waypoint, a waypoint moves, an orthogonal segment moves across its direction (the route
 * turns at a waypoint there: the nearest existing one moves, else one is made). Undefined for an end (see
 * {@link endDrop}).
 *
 * @public
 */
export function handleEdit(id: RecordId, original: ConnectorElement['route'], handle: ConnectorHandle, p: Vec2): ParamCommand | undefined {
  const waypoints = [...(original.waypoints ?? [])];
  switch (
    handle.role // kind-switch-allow: the closed set of handle roles, not element kinds
  ) {
    case 'mid':
      return waypointEdit(id, original, handle.at as number, p);
    case 'way':
      waypoints[handle.at as number] = p;
      return update(id, withWaypoints(original, waypoints));
    case 'seg': {
      // the waypoint takes the pointer's coordinate across the segment and keeps its own along it (the segments on either
      // side of it turn at its other coordinate, so they stay); with none yet, the segment's middle is where it is made
      const at = waypoints.length === 0 ? 0 : nearestTo(waypoints, handle.page);
      const from = waypoints[at] ?? handle.page;
      waypoints[at] = handle.axis === 'x' ? { x: p.x, y: from.y } : { x: from.x, y: p.y };
      return update(id, original.waypoints?.length ? withWaypoints(original, waypoints) : withNewWaypoint(original, waypoints, 0));
    }
    case 'tan':
      return handle.from === undefined ? undefined : update(id, withTangent(original, handle.at as number, { x: p.x - handle.from.x, y: p.y - handle.from.y }));
    default:
      return undefined;
  }
}

/**
 * The commands that drop the `end` of the connector `id` at page point `p` on the element `onto` (if any), in the
 * order to run them as one undo step: bind to `onto` at its anchor nearest `p` that is not full, within `tolerance`
 * (page units; any distance when absent), else `auto` (FR-ANC-006, FR-ANC-003); with no element, move a free end to
 * `p`, and let a bound one go there (`connector.freeEnd`: dragged away from its shape).
 *
 * @public
 */
export function endDrop(
  view: ReadView,
  shapeDefs: { get(id: string): ShapeDef | undefined },
  drop: {
    readonly connector: RecordId;
    readonly end: 'source' | 'target';
    readonly onto: RecordId | undefined;
    readonly at: Vec2;
    readonly newId: () => RecordId;
    readonly tolerance?: number | undefined;
    /** Whether another element covers a page point over `onto` (none when absent): an anchor there is not snapped to. */
    readonly covered?: ((p: Vec2) => boolean) | undefined;
  },
): readonly ParamCommand[] {
  const { connector, end, onto, at } = drop;
  const target = onto === undefined ? undefined : (view.get(onto) as ShapeElement | undefined);
  const bound = view.members('bindingsByElement', connector).some((b) => {
    const r = view.get(b) as { readonly type?: unknown; readonly connectorId?: unknown; readonly end?: unknown } | undefined;
    return r?.type === 'binding' && r.connectorId === connector && r.end === end;
  });
  if (target?.transform === undefined || onto === undefined) {
    return bound
      ? [{ id: 'connector.freeEnd', args: { connectorId: connector, end, at } }]
      : [{ id: 'element.update', args: { id: connector, fields: { [end === 'source' ? 'freeSource' : 'freeTarget']: at } } }];
  }
  const anchor = snapAnchor(view, shapeDefs, {
    elementId: onto,
    at,
    tolerance: drop.tolerance ?? Number.POSITIVE_INFINITY,
    except: { connector, end },
    covered: drop.covered,
  });
  return [{ id: 'binding.set', args: { id: drop.newId(), connectorId: connector, end, elementId: onto, anchor } }];
}
