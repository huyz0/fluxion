// The global routing pass (FR-RTE-003, ADR-0044): every orthogonal connector of a screen routed as one batch, around the shapes, on one
// sparse grid (A* that pays to cross routes already placed), then simplified and nudged apart. It runs in a worker once a drag settles; the
// input is plain data (structured-clone), built on the page's thread by `globalRouteInput` from the cheap routes' resolved ends.

import type { ReadView } from '@fluxion/core';
import { type Box, elementBounds, type PathCommand, type Vec2 } from '@fluxion/geometry';
import { type RecordId, type Transform, transformRotation } from '@fluxion/schema';
import { type RouteContext, routeConnector } from './connector-route.js';
import { buildGrid } from './orthogonal/grid.js';
import { nudge } from './orthogonal/nudge.js';
import { type RouteSegment, searchRoute } from './orthogonal/search.js';
import { simplify } from './orthogonal/simplify.js';
import { ORTHOGONAL_STUB } from './orthogonal.js';
import type { RouteEnd } from './router.js';

/**
 * A box the global pass routes around.
 *
 * @public
 */
export type GlobalObstacle = {
  /** The element's id. */
  readonly id: string;
  /** Its axis-aligned bounds on the screen. */
  readonly box: Box;
};

/**
 * A connector the global pass routes, with its ends as the cheap pass resolves them.
 *
 * @public
 */
export type GlobalConnector = {
  /** The connector's id. */
  readonly id: string;
  /** Its source end. */
  readonly source: RouteEnd;
  /** Its target end. */
  readonly target: RouteEnd;
};

/**
 * What the global pass routes: the boxes to go around and the connectors with their resolved ends.
 *
 * @public
 */
export type GlobalRouteInput = {
  /** The boxes routes go around (shapes, text, images, components of the screen). */
  readonly obstacles: readonly GlobalObstacle[];
  /** The connectors to route, in a stable order. */
  readonly connectors: readonly GlobalConnector[];
  /** Clearance kept around obstacles, px (default 8). */
  readonly margin?: number;
  /** Distance nudge keeps between routes sharing a channel, px (default 6). */
  readonly spacing?: number;
};

/**
 * One connector's route from the global pass.
 *
 * @public
 */
export type GlobalRoute = {
  /** The connector's id. */
  readonly id: string;
  /** Its path, absolute commands from source to target. */
  readonly commands: readonly PathCommand[];
};

/** Element kinds a route goes around (a group or frame encloses its members; a connector is a route itself). */
const SOLID = new Set(['shape', 'text', 'image', 'component']);

const inside = (p: Vec2, b: Box, m: number) => p.x >= b.x - m && p.x <= b.x + b.w + m && p.y >= b.y - m && p.y <= b.y + b.h + m;
/** The axis direction an end leaves along, as the orthogonal router snaps it: its anchor direction, else toward `other`. */
function axisOf(end: RouteEnd, other: Vec2): Vec2 {
  const v = end.dir ?? { x: other.x - end.point.x, y: other.y - end.point.y };
  if (v.x === 0 && v.y === 0) return { x: 1, y: 0 };
  return Math.abs(v.x) >= Math.abs(v.y) ? { x: Math.sign(v.x), y: 0 } : { x: 0, y: Math.sign(v.y) };
}

/** Stub lengths tried, longest first: shapes closer together than a stub and the margin leave room only for a shorter one. */
const STUBS = [ORTHOGONAL_STUB, ORTHOGONAL_STUB / 2, ORTHOGONAL_STUB / 4, 1];

/** The tip of the longest stub out of `p` along `d` clear of every box of `around` (the last one tried when none is). */
function tip(p: Vec2, d: Vec2, around: readonly Box[], margin: number): Vec2 {
  const at = (len: number): Vec2 => ({ x: p.x + d.x * len, y: p.y + d.y * len });
  return at(STUBS.find((len) => !around.some((b) => inside(at(len), b, margin))) ?? (STUBS.at(-1) as number));
}

/**
 * The routes of `input`'s connectors: one grid for the batch; per connector an A* between its stub tips around every obstacle but the ones
 * its ends sit on, paying to cross routes already placed; then simplify, and one nudge over the batch. A connector the search cannot route
 * is left out (its cheap route stands). Pure: the same input gives the same routes.
 *
 * @public
 */
export function globalRoutes(input: GlobalRouteInput): GlobalRoute[] {
  const margin = input.margin ?? 8;
  const ends = input.connectors.map((c) => {
    // the shapes an end sits on are not in its way (its stub leaves them)
    const avoid = input.obstacles.map((o) => o.box).filter((b) => !inside(c.source.point, b, margin) && !inside(c.target.point, b, margin));
    const [ds, dt] = [axisOf(c.source, c.target.point), axisOf(c.target, c.source.point)];
    return { ...c, avoid, ds, dt, from: tip(c.source.point, ds, avoid, margin), to: tip(c.target.point, dt, avoid, margin) };
  });
  const grid = buildGrid({ obstacles: [...input.obstacles], stubs: ends.flatMap((e) => [e.source.point, e.from, e.to, e.target.point]), margin });
  const placed: RouteSegment[] = [];
  const routed: { readonly id: string; readonly points: Vec2[]; readonly avoid: readonly Box[] }[] = [];
  for (const e of ends) {
    const { avoid } = e;
    const path = searchRoute({ grid, obstacles: avoid, margin, start: e.from, startDir: e.ds, goal: e.to, goalDir: e.dt, existing: placed });
    if (path === undefined) continue;
    const points = simplify([e.source.point, ...path, e.target.point]);
    routed.push({ id: e.id, points, avoid });
    for (let k = 1; k < points.length; k++) placed.push({ from: points[k - 1] as Vec2, to: points[k] as Vec2 });
  }
  const spread = nudge(routed, input.spacing ?? 6);
  return routed.map((r, k) => ({ id: r.id, commands: (spread[k] ?? r.points).map((to, i): PathCommand => ({ kind: i === 0 ? 'M' : 'L', to })) }));
}

type ElementLike = {
  readonly type?: unknown;
  readonly kind?: unknown;
  readonly screenId?: unknown;
  readonly transform?: Transform;
  readonly route?: { readonly type?: unknown; readonly waypoints?: readonly unknown[] };
};

/**
 * The global pass's input for screen `screenId`: its solid elements' bounds, and its orthogonal connectors without waypoints (waypoints are
 * the author's constraints) with the ends the cheap pass resolves. Sorted by id.
 *
 * @public
 */
export function globalRouteInput(view: ReadView, ctx: RouteContext, screenId: RecordId): GlobalRouteInput {
  const ids = [...view.members('byScreen', screenId)].sort() as RecordId[];
  const records = ids.map((id) => [id, view.get(id) as ElementLike | undefined] as const);
  const obstacles = records.flatMap(([id, r]) =>
    r?.type === 'element' && SOLID.has(r.kind as string) && r.transform !== undefined
      ? [{ id, box: elementBounds({ ...r.transform, rot: transformRotation(r.transform) }) }]
      : [],
  );
  const connectors = records.flatMap(([id, r]) => {
    if (r?.kind !== 'connector' || r.route?.type !== 'orthogonal' || (r.route.waypoints?.length ?? 0) > 0) return [];
    const route = routeConnector(view, ctx, id);
    return route === undefined ? [] : [{ id, source: route.source, target: route.target }];
  });
  return { obstacles, connectors };
}
