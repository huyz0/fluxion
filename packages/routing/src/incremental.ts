// Incremental rerouting (FR-RTE-002): the bindings index (`bindingsByElement`) names the connectors a move
// touches, so a drag reroutes those and nothing else, with the cheap pass; the full pass runs when it settles.
import type { ReadView } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { type ConnectorRoute, type RouteContext, routeConnector } from './connector-route.js';

type BindingLike = { readonly type?: unknown; readonly connectorId?: unknown };

/** The connectors with an end bound to `element`. */
function boundTo(view: ReadView, element: RecordId): RecordId[] {
  return view
    .members('bindingsByElement', element)
    .map((id) => view.get(id) as BindingLike | undefined)
    .filter((b) => b?.type === 'binding')
    .map((b) => b?.connectorId as RecordId);
}

/**
 * The connectors whose route can change when the elements `moved` change: those bound to them, and those
 * bound to those (an end on another connector follows it, FR-CON-009). Sorted, each once.
 *
 * @public
 */
export function affectedConnectors(view: ReadView, moved: readonly RecordId[]): RecordId[] {
  const found = new Set<RecordId>();
  const queue = [...moved];
  for (let next = queue.pop(); next !== undefined; next = queue.pop())
    for (const id of boundTo(view, next))
      if (!found.has(id)) {
        found.add(id);
        queue.push(id);
      }
  return [...found].sort();
}

/**
 * The routes of the connectors the elements `moved` affect, by the cheap pass (no nudging, no labels) for a
 * drag, or the full pass when `quality` is `full`.
 *
 * @public
 */
export function rerouteAffected(
  view: ReadView,
  ctx: RouteContext,
  moved: readonly RecordId[],
  quality: 'cheap' | 'full' = 'cheap',
): ReadonlyMap<RecordId, ConnectorRoute | undefined> {
  const at = { ...ctx, quality };
  return new Map(affectedConnectors(view, moved).map((id) => [id, routeConnector(view, at, id)]));
}
