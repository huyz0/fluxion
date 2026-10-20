// Parallel connectors in a document (FR-CON-011, ADR-0042): a connector between the same two elements as others is moved aside by its
// offset among them (parallel.ts numbers each pair's connectors in id order). Reads the bindings through a ReadView, so a query routing a
// connector re-runs when a connector is bound to or unbound from either of its elements.
import type { ReadView } from '@fluxion/core';
import type { PathCommand, Vec2 } from '@fluxion/geometry';
import type { RecordId, Route } from '@fluxion/schema';
import { fanOrthogonal, fanWaypoint, type ParallelEdge, parallelOffsets } from './parallel.js';

/** How far apart parallel connectors are drawn, px. */
export const FAN_SPACING = 16;

type BindingLike = { readonly type?: unknown; readonly connectorId?: unknown; readonly end?: unknown; readonly elementId?: unknown };
type Routed = { readonly route?: Route };

/** The element each end of `connectorId` is bound to, by end; an end bound to a connector (it has a route) or not bound is absent. */
function boundEnds(view: ReadView, connectorId: RecordId): { source?: string; target?: string } {
  const ends: { source?: string; target?: string } = {};
  for (const id of view.members('bindingsByElement', connectorId)) {
    const b = view.get(id) as BindingLike | undefined;
    if (b?.type !== 'binding' || b.connectorId !== connectorId || (b.end !== 'source' && b.end !== 'target') || typeof b.elementId !== 'string') continue;
    if ((view.get(b.elementId as RecordId) as Routed | undefined)?.route === undefined) ends[b.end] = b.elementId;
  }
  return ends;
}

/** The bindings of `a` or of `b`, whichever has fewer. */
function fewerBindings(view: ReadView, a: string, b: string): readonly RecordId[] {
  const ofA = view.members('bindingsByElement', a);
  const ofB = view.members('bindingsByElement', b);
  return ofB.length < ofA.length ? ofB : ofA;
}

/**
 * The connectors without waypoints that join `a` and `b`, either way round. Each is bound to both, so the bindings of the end with fewer
 * are read: a hub's 200 spokes each read their leaf's one binding, not the hub's 200 (NFR-PERF-005, M16.40).
 */
function joining(view: ReadView, a: string, b: string): ParallelEdge[] {
  const edges: ParallelEdge[] = [];
  const seen = new Set<string>();
  for (const id of fewerBindings(view, a, b)) {
    const c = (view.get(id) as BindingLike | undefined)?.connectorId;
    if (typeof c !== 'string' || seen.has(c)) continue;
    seen.add(c);
    if (placed(view, c as RecordId)) continue;
    const ends = boundEnds(view, c as RecordId);
    if ((ends.source === a && ends.target === b) || (ends.source === b && ends.target === a)) edges.push({ id: c, a, b });
  }
  return edges;
}

/** Whether `connectorId` has waypoints: the author placed it, so it is not moved aside. */
const placed = (view: ReadView, connectorId: RecordId): boolean => ((view.get(connectorId) as Routed | undefined)?.route?.waypoints ?? []).length > 0;

/**
 * The offset of `connectorId` among the connectors that join the same two elements (either way round), or undefined when it is the only
 * one, is not bound to two distinct elements, or has waypoints (the author placed it).
 */
export function fanOffsetOf(view: ReadView, connectorId: RecordId, spacing: number = FAN_SPACING): number | undefined {
  if (placed(view, connectorId)) return undefined;
  const { source: a, target: b } = boundEnds(view, connectorId);
  if (a === undefined || b === undefined || a === b) return undefined;
  const edges = joining(view, a, b);
  // id order: the same numbering on every machine and whichever connector asks
  edges.sort((u, v) => (u.id < v.id ? -1 : u.id > v.id ? 1 : 0));
  return parallelOffsets(edges, spacing).get(connectorId);
}

/** An orthogonal path moved aside by `offset` (its longest inner segment, or a jog in a straight run); a path with curves is left as it is. */
function fannedOrthogonal(commands: readonly PathCommand[], offset: number): readonly PathCommand[] {
  // a move, then lines only
  if (!commands.every((c, k) => c.kind === (k === 0 ? 'M' : 'L'))) return commands;
  const moved = fanOrthogonal(
    commands.map((c) => (c as { readonly to: Vec2 }).to),
    offset,
  );
  return moved.map((to, k): PathCommand => (k === 0 ? { kind: 'M', to } : { kind: 'L', to }));
}

type Fanner = (
  route: Route,
  line: { readonly from: Vec2; readonly to: Vec2; readonly offset: number },
  run: (route: Route) => readonly PathCommand[],
) => readonly PathCommand[];

/** A straight line bent once, at the point `offset` beside its chord. */
const bent: Fanner = (_, { from, to, offset }) => [
  { kind: 'M', to: from },
  { kind: 'L', to: fanWaypoint(from, to, offset) },
  { kind: 'L', to },
];

/** `tangents` keyed by route point once a point is put in at index 1: the source's stays at 0, every later point's moves up one. */
function shiftedTangents(tangents: Route['tangents']): Pick<Route, 'tangents'> {
  if (tangents === undefined) return {};
  return { tangents: Object.fromEntries(Object.entries(tangents).map(([k, v]) => [k === '0' ? k : String(Number(k) + 1), v])) };
}

/** How each built-in route type moves aside; another router's path is drawn as it is. */
const FANNED: Readonly<Record<string, Fanner>> = {
  // the bow's waypoint is route point 1: the tangents the author set at the target keep to the target
  curved: (route, { from, to, offset }, run) => run({ ...route, waypoints: [fanWaypoint(from, to, offset)], ...shiftedTangents(route.tangents) }),
  straight: bent,
  polyline: bent,
  orthogonal: (route, { offset }, run) => fannedOrthogonal(run(route), offset),
};

/**
 * The path of a connector moved aside by `offset` from the line `from`-`to`: a curved route through a waypoint beside the chord (its
 * router, `run`, draws it), a straight or waypoint-less polyline bent once at that point, an orthogonal route with its longest inner segment
 * shifted; another router's path as it draws it.
 */
export function fannedPath(
  route: Route,
  line: { readonly from: Vec2; readonly to: Vec2; readonly offset: number },
  run: (route: Route) => readonly PathCommand[],
): readonly PathCommand[] {
  return (FANNED[route.type] ?? ((r, _, go) => go(r)))(route, line, run);
}
