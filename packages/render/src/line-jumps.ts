// Line jumps (FR-CON-008): where two connectors of a screen cross, the one painted later hops over the other, in the style the connector's
// `route.jumps` sets or else the document's (`settings.lineJumps`: arcs when on, none when off or absent). One store query per store and
// registries finds every screen's crossings (geometry's sweep), and each connector view reads its own hops through a query of its own entry.
// Nothing is routed for a document that draws no hops: unless the document turns jumps on or a connector asks for them, the query only reads
// the connectors' route fields. While hops are drawn, each connector's route is a query of its own, so a drag re-routes only the connectors it
// moves, and an entry whose hops did not change keeps its identity, so no other connector view redraws.
import type { ReadSignal, ReadView, Store } from '@fluxion/core';
import { createPathSampler, type PathCommand, pathFromCommands, polylineCrossings, type Vec2 } from '@fluxion/geometry';
import { type Jump, type JumpStyle, type RouteContext, routeConnector } from '@fluxion/routing';
import type { RecordId, Route } from '@fluxion/schema';
import { type Context, createContext } from 'react';
import { elementsInOrder } from './screen-order.js';

/** A crossing a connector hops over, with the connector it crosses. */
export type Hop = Jump & { readonly over: string };

/**
 * The hops one connector draws, and how.
 */
export type ConnectorHops = {
  /** Where it crosses connectors painted before it, by segment of its route. */
  readonly jumps: readonly Hop[];
  /** An arc over each crossing, or a gap in the line. */
  readonly style: 'arc' | 'gap';
};

/** The elements a build hides on the screen being drawn (ScreenView's `hidden`): a connector does not hop over one of them. */
export const BuildHiddenContext: Context<ReadonlySet<RecordId> | undefined> = createContext<ReadonlySet<RecordId> | undefined>(undefined);

type ElementLike = { readonly type?: unknown; readonly kind?: unknown; readonly route?: Route; readonly parentId?: RecordId };
type DocumentLike = { readonly settings?: { readonly lineJumps?: boolean } };
type Routes = (id: RecordId) => readonly PathCommand[] | undefined;
type Line = { readonly id: string; readonly points: Vec2[]; readonly style: JumpStyle };

const NONE: ReadonlyMap<string, ConnectorHops> = new Map();
/** Points sampled along a route that has curves, for its crossings. */
const CURVE_SAMPLES = 32;

/** The corner points of a route of straight segments, or undefined when it has curves or gaps (it cannot hop: hopPath draws polylines). */
function corners(commands: readonly PathCommand[]): Vec2[] | undefined {
  // a move, then lines only
  if (!commands.every((c, k) => c.kind === (k === 0 ? 'M' : 'L'))) return undefined;
  return commands.map((c) => (c as { readonly to: Vec2 }).to);
}

/** The route as a polyline others may cross: its corners, or points sampled along it when it has curves. */
function polyline(commands: readonly PathCommand[]): Vec2[] {
  const straight = corners(commands);
  if (straight !== undefined) return straight;
  const path = pathFromCommands(commands);
  if (!path.ok) return [];
  const sampler = createPathSampler(path.value);
  return Array.from({ length: CURVE_SAMPLES + 1 }, (_, k) => sampler.pointAtFraction(k / CURVE_SAMPLES));
}

/** The connectors of a screen in painting order: top-level elements in z-order, each group's children after it. */
function connectorsInOrder(view: ReadView, screenId: RecordId): RecordId[] {
  const out: RecordId[] = [];
  const walk = (ids: readonly RecordId[]): void => {
    for (const id of ids) {
      if ((view.get(id) as ElementLike | undefined)?.kind === 'connector') out.push(id);
      walk(elementsInOrder(view, screenId, id));
    }
  };
  walk(elementsInOrder(view, screenId));
  return out;
}

/** The lines of a screen in painting order, each with the style its crossings take: its own, else the document's; a route with curves does not hop. */
function linesOf(view: ReadView, screenId: RecordId, routes: Routes, documentStyle: JumpStyle): Line[] {
  const lines: Line[] = [];
  for (const id of connectorsInOrder(view, screenId)) {
    const commands = routes(id);
    if (commands === undefined) continue;
    const own = (view.get(id) as ElementLike | undefined)?.route?.jumps ?? documentStyle;
    lines.push({ id, points: polyline(commands), style: corners(commands) === undefined ? 'none' : own });
  }
  return lines;
}

/** Each crossing goes to the line painted later (the higher index), unless its style is `none`. */
function screenHops(lines: readonly Line[], out: Map<string, ConnectorHops>): void {
  const z = new Map(lines.map((l, k) => [l.id, k]));
  const found = new Map<string, Hop[]>();
  for (const c of polylineCrossings(lines)) {
    const aTop = (z.get(c.a) ?? 0) > (z.get(c.b) ?? 0);
    const [top, over, segment] = aTop ? [c.a, c.b, c.aSegment] : [c.b, c.a, c.bSegment];
    if (lines[z.get(top) ?? 0]?.style === 'none') continue;
    found.set(top, [...(found.get(top) ?? []), { at: c.at, segment, over }]);
  }
  for (const [id, jumps] of found) out.set(id, { jumps, style: lines[z.get(id) ?? 0]?.style as 'arc' | 'gap' });
}

const sameHop = (p: Hop, q: Hop | undefined): boolean =>
  q !== undefined && p.segment === q.segment && p.over === q.over && p.at.x === q.at.x && p.at.y === q.at.y;
const sameHops = (p: ConnectorHops, q: ConnectorHops | undefined): boolean =>
  q !== undefined && p.style === q.style && p.jumps.length === q.jumps.length && p.jumps.every((j, k) => sameHop(j, q.jumps[k]));

/** `next` with every entry equal to the one in `previous` replaced by it, or `previous` itself when nothing changed. */
function stable(next: Map<string, ConnectorHops>, previous: ReadonlyMap<string, ConnectorHops>): ReadonlyMap<string, ConnectorHops> {
  if (next.size === 0) return NONE;
  let changed = next.size !== previous.size;
  for (const [id, hops] of next) {
    const before = previous.get(id);
    if (before !== undefined && sameHops(hops, before)) next.set(id, before);
    else changed = true;
  }
  return changed ? next : previous;
}

/** Every connector's hops, by connector id, over the screens of `view`. */
function hopsOf(view: ReadView, routes: Routes): Map<string, ConnectorHops> | undefined {
  const doc = view.get(view.members('byType', 'document')[0] ?? ('' as RecordId)) as DocumentLike | undefined;
  const documentStyle: JumpStyle = doc?.settings?.lineJumps === true ? 'arc' : 'none';
  const elements = view.members('byType', 'element').map((id) => view.get(id) as ElementLike | undefined);
  // nothing hops: no connector routed for it
  if (documentStyle === 'none' && !elements.some((e) => e?.kind === 'connector' && (e.route?.jumps === 'arc' || e.route?.jumps === 'gap'))) return undefined;
  const out = new Map<string, ConnectorHops>();
  for (const screenId of view.members('byType', 'screen')) screenHops(linesOf(view, screenId, routes, documentStyle), out);
  return out;
}

/** A route query per connector, made on first use; the ones of connectors no longer in the store are dropped. */
function routeQueries(store: Store, ctx: RouteContext): { readonly routes: Routes; readonly prune: (view: ReadView) => void } {
  const queries = new Map<RecordId, ReadSignal<readonly PathCommand[] | undefined>>();
  const routes: Routes = (id) => {
    let q = queries.get(id);
    if (q === undefined) {
      q = store.query((view) => routeConnector(view, ctx, id)?.commands);
      queries.set(id, q);
    }
    return q();
  };
  const prune = (view: ReadView) => {
    for (const id of queries.keys()) if (!view.has(id)) queries.delete(id);
  };
  return { routes, prune };
}

type Hops = { readonly all: ReadSignal<ReadonlyMap<string, ConnectorHops>>; readonly byId: Map<RecordId, ReadSignal<ConnectorHops | undefined>> };

const queries = new WeakMap<Store, WeakMap<RouteContext, Hops>>();

function hopsQuery(store: Store, ctx: RouteContext): Hops {
  const byContext = queries.get(store) ?? new WeakMap();
  queries.set(store, byContext);
  const known = byContext.get(ctx);
  if (known !== undefined) return known;
  const { routes, prune } = routeQueries(store, ctx);
  const byId = new Map<RecordId, ReadSignal<ConnectorHops | undefined>>();
  let previous: ReadonlyMap<string, ConnectorHops> = NONE;
  const all = store.query((view) => {
    const next = hopsOf(view, routes);
    prune(view);
    for (const id of byId.keys()) if (!view.has(id)) byId.delete(id);
    previous = next === undefined ? NONE : stable(next, previous);
    return previous;
  });
  const made = { all, byId };
  byContext.set(ctx, made);
  return made;
}

/**
 * The hops of every connector of `store`, routed with `ctx`, as a store query (one per store and context): it re-runs when a route or a
 * jump setting changes, keeps each entry whose hops did not change, and stays the same map while nothing changed.
 */
export function lineJumps(store: Store, ctx: RouteContext): ReadSignal<ReadonlyMap<string, ConnectorHops>> {
  return hopsQuery(store, ctx).all;
}

/** The hops of connector `id` as a query of its own: it changes only when that connector's hops do. */
export function hopsOfConnector(store: Store, ctx: RouteContext, id: RecordId): ReadSignal<ConnectorHops | undefined> {
  const { all, byId } = hopsQuery(store, ctx);
  let q = byId.get(id);
  if (q === undefined) {
    q = store.query(() => all().get(id));
    byId.set(id, q);
  }
  return q;
}

/** Whether `id` or a group it is in is hidden. */
function hiddenIn(view: ReadView, hidden: ReadonlySet<RecordId>, id: RecordId): boolean {
  for (let at: RecordId | undefined = id; at !== undefined; at = (view.get(at) as ElementLike | undefined)?.parentId) if (hidden.has(at)) return true;
  return false;
}

/** `hops` without those over a connector a build hides (it, or a group it is in, is in `hidden`). */
export function visibleHops(view: ReadView, hops: ConnectorHops | undefined, hidden: ReadonlySet<RecordId> | undefined): ConnectorHops | undefined {
  if (hops === undefined || hidden === undefined || hidden.size === 0) return hops;
  const jumps = hops.jumps.filter((j) => !hiddenIn(view, hidden, j.over as RecordId));
  return jumps.length === hops.jumps.length ? hops : jumps.length === 0 ? undefined : { ...hops, jumps };
}
