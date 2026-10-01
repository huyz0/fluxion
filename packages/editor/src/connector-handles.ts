// Connector handles (FR-CON-007, M7.18): where the ends and the middles of the selected connector's route are,
// which one a press is on, and the writes a drag makes. An end dragged onto an element binds there, at the anchor
// of the element nearest the drop (a free end dropped on nothing moves to the drop; a bound one dropped on nothing
// stays); a middle dragged out becomes a waypoint. Pure: the select tool and the overlay only call these.
import type { ReadView, ShapeDef } from '@fluxion/core';
import type { Vec2 } from '@fluxion/geometry';
import { DEFAULT_ANCHORS, resolveAnchor, shapeAnchorTarget } from '@fluxion/routing';
import type { AnchorDef, ConnectorElement, RecordId, ShapeElement, Transform } from '@fluxion/schema';
import type { ParamCommand } from './param-handles.js';

/**
 * A handle of a connector's route.
 *
 * @public
 */
export type ConnectorHandle = {
  /** `end`: an end of the route; `mid`: the middle of a stretch of it, which becomes a waypoint when dragged. */
  readonly role: 'end' | 'mid';
  /** For an end, which; for a middle, the index its waypoint would have in the route's waypoints. */
  readonly at: 'source' | 'target' | number;
  /** Where it is, page units. */
  readonly page: Vec2;
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
  const nodes = [routed.source.point, ...(connector.route.waypoints ?? []), routed.target.point];
  const mids = nodes.slice(1).map((to, k): ConnectorHandle => ({ role: 'mid', at: k, page: middle(nodes[k] as Vec2, to) }));
  return [{ role: 'end', at: 'source', page: routed.source.point }, { role: 'end', at: 'target', page: routed.target.point }, ...mids];
}

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
    // within reach, nearest first; at an equal distance an end sits ahead of a middle
    if (d < bestDistance || (d === bestDistance && (best === undefined || (best.role === 'mid' && h.role === 'end')))) {
      best = h;
      bestDistance = d;
    }
  }
  return best;
}

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
  return { id: 'element.update', args: { id, fields: { route: { ...original, type: original.type === 'straight' ? 'polyline' : original.type, waypoints } } } };
}

/** The names of the anchors an element offers: its own, its definition's, then the defaults. */
function anchorNames(element: ShapeElement | undefined, def: ShapeDef | undefined): readonly string[] {
  const own: readonly AnchorDef[] = [...(element?.anchors ?? []), ...(def?.anchors ?? [])];
  return [...new Set([...own, ...DEFAULT_ANCHORS].map((a) => a.name))];
}

/**
 * The commands that drop the `end` of the connector `id` at page point `p` on the element `onto` (if any), in the
 * order to run them as one undo step: bind to `onto` at its anchor nearest `p`; with no element, move a free end to
 * `p`, and leave a bound one where it is (none).
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
  },
): readonly ParamCommand[] {
  const { connector, end, onto, at } = drop;
  const target = onto === undefined ? undefined : (view.get(onto) as ShapeElement | undefined);
  const bound = view.members('bindingsByElement', connector).some((b) => {
    const r = view.get(b) as { readonly type?: unknown; readonly connectorId?: unknown; readonly end?: unknown } | undefined;
    return r?.type === 'binding' && r.connectorId === connector && r.end === end;
  });
  if (target?.transform === undefined || onto === undefined) {
    return bound ? [] : [{ id: 'element.update', args: { id: connector, fields: { [end === 'source' ? 'freeSource' : 'freeTarget']: at } } }];
  }
  // only a shape has a definition with anchors of its own
  const shape = typeof (target as { defId?: unknown }).defId === 'string' ? target : undefined;
  const def = shape === undefined ? undefined : shapeDefs.get(shape.defId);
  const t: Transform = target.transform;
  const anchorTarget = shapeAnchorTarget(t, def, target);
  const names = anchorNames(shape, def);
  const nearest = names
    .map((name) => ({ name, point: resolveAnchor(anchorTarget, { kind: 'named', name }, at).point }))
    .map(({ name, point }) => ({ name, d: Math.hypot(point.x - at.x, point.y - at.y) }))
    .reduce((best, c) => (c.d < best.d ? c : best));
  return [{ id: 'binding.set', args: { id: drop.newId(), connectorId: connector, end, elementId: onto, anchor: { kind: 'named', name: nearest.name } } }];
}
