// The pen and freehand tools (FR-EDT-003): pen clicks place a path's vertices (Enter, or a click back
// on the last vertex, ends it; Esc drops it), freehand draws a stroke with a drag. Each adds one shape
// of the basic pack's open paths, `basic:polyline` or `basic:freehand`, whose points are fractions of
// its box: one element.create, one undo step (create-tool.ts). The overlay draws the line so far (the
// session's sketch).
import { type Box, boxFromPoints, type Vec2 } from '@fluxion/geometry';
import type { AnyRecord } from '@fluxion/schema';
import { createElement, type ElementMaker } from './create-tool.js';
import { DRAG_PX } from './selection.js';
import type { Tool, ToolCtx } from './tools.js';

/**
 * How far apart, in canvas px, a freehand stroke's kept points are at least.
 *
 * @public
 */
export const FREEHAND_STEP_PX = 2;

/**
 * The most points a path keeps (the basic pack's paths take up to 10 000).
 *
 * @public
 */
export const MAX_PATH_POINTS = 10_000;

/**
 * A path placed in a box: the box, page units, and its points as fractions of it.
 *
 * @public
 */
export type PathBox = {
  /** The box, at least 1 page unit each way. */
  readonly box: Box;
  /** Each point as [x, y] fractions of the box. */
  readonly fractions: readonly (readonly [number, number])[];
};

/**
 * The box of `points`, at least 1 page unit each way, and the points as fractions of it.
 *
 * @public
 */
export function pathBox(points: readonly Vec2[]): PathBox | undefined {
  const bounds = boxFromPoints(points);
  if (bounds === null) return undefined;
  const box = { x: bounds.x, y: bounds.y, w: Math.max(bounds.w, 1), h: Math.max(bounds.h, 1) };
  // a straight run along an axis sits in the middle of its box's other side
  const u = (p: Vec2) => (bounds.w === 0 ? 0.5 : (p.x - box.x) / box.w);
  const v = (p: Vec2) => (bounds.h === 0 ? 0.5 : (p.y - box.y) / box.h);
  return { box, fractions: points.map((p) => [u(p), v(p)] as const) };
}

/** Every `k`-th of `points` (the last kept), so that at most MAX_PATH_POINTS remain. */
function capped(points: readonly Vec2[]): readonly Vec2[] {
  // tzap disable next-line ConditionalExpression, EqualityOperator: a short path's k is 1, which keeps every point anyway
  if (points.length <= MAX_PATH_POINTS) return points;
  const k = Math.ceil(points.length / (MAX_PATH_POINTS - 1));
  return [...points.filter((_, i) => i % k === 0 && i < points.length - 1), points.at(-1) as Vec2];
}

/** A `defId` shape through `points`, its param `param` their fractions of its box. */
function pathMaker(defId: string, param: string, fractions: readonly (readonly [number, number])[]): ElementMaker {
  return (at) =>
    ({
      id: at.id,
      type: 'element',
      screenId: at.screenId,
      index: at.index,
      transform: at.transform,
      kind: 'shape',
      defId,
      params: { [param]: fractions },
    }) as AnyRecord;
}

/** Add the path `defId` through `points`: at least two, and not all at one spot. */
function addPath(ctx: ToolCtx, defId: string, param: string, points: readonly Vec2[]): void {
  const z = ctx.session.camera.get().z;
  const placed = pathBox(capped(points));
  const spread = placed === undefined ? 0 : Math.max(placed.box.w, placed.box.h) * z;
  // tzap disable next-line EqualityOperator: a path exactly DRAG_PX across is kept either way
  if (placed === undefined || points.length < 2 || spread < DRAG_PX) return;
  createElement(ctx, placed.box, pathMaker(defId, param, placed.fractions));
}

/**
 * The freehand tool (D): a drag draws a `basic:freehand` stroke through the points it passed, kept
 * FREEHAND_STEP_PX canvas px apart.
 *
 * @public
 */
export function freehandTool(): Tool {
  let points: Vec2[] = [];
  const keep = (ctx: ToolCtx, p: Vec2) => {
    const last = points.at(-1);
    const z = ctx.session.camera.get().z;
    if (last === undefined || Math.hypot(p.x - last.x, p.y - last.y) * z >= FREEHAND_STEP_PX) points.push(p);
  };
  return {
    id: 'freehand',
    title: 'Freehand',
    shortcut: 'd',
    initial: 'idle',
    states: {
      idle: {
        id: 'idle',
        onPointerDown: (_ctx, e) => {
          if (e.button !== 0) return undefined;
          points = [e.page];
          return { to: 'drawing' };
        },
      },
      drawing: {
        id: 'drawing',
        onPointerMove: (ctx, e) => {
          for (const c of e.coalesced.length > 0 ? e.coalesced : [e]) keep(ctx, c.page);
          ctx.session.sketch.set([...points]);
          return undefined;
        },
        onPointerUp: (ctx, e) => {
          keep(ctx, e.page);
          ctx.session.sketch.set(undefined);
          addPath(ctx, 'basic:freehand', 'stroke', points);
          return { to: 'idle' };
        },
        onCancel: (ctx) => {
          ctx.session.sketch.set(undefined);
          return { to: 'idle' };
        },
      },
    },
  };
}

/**
 * The pen tool (P): each click places a vertex of a `basic:polyline`; Enter, or a click back on the
 * last vertex, ends it; Esc drops it.
 *
 * @public
 */
export function penTool(): Tool {
  let vertices: Vec2[] = [];
  const end = (ctx: ToolCtx) => {
    addPath(ctx, 'basic:polyline', 'vertices', vertices);
    return { to: 'idle' };
  };
  return {
    id: 'pen',
    title: 'Pen',
    shortcut: 'p',
    initial: 'idle',
    states: {
      idle: {
        id: 'idle',
        onPointerDown: (ctx, e) => {
          if (e.button !== 0) return undefined;
          vertices = [e.page];
          ctx.session.sketch.set([e.page]);
          return { to: 'placing' };
        },
      },
      placing: {
        id: 'placing',
        onPointerMove: (ctx, e) => {
          ctx.session.sketch.set([...vertices, e.page]);
          return undefined;
        },
        onPointerDown: (ctx, e) => {
          if (e.button !== 0) return undefined;
          const last = vertices.at(-1) as Vec2;
          // a click back on the last vertex ends the path
          if (Math.hypot(e.page.x - last.x, e.page.y - last.y) * ctx.session.camera.get().z < DRAG_PX) return end(ctx);
          vertices.push(e.page);
          ctx.session.sketch.set([...vertices]);
          return undefined;
        },
        onKeyDown: (ctx, e) => (e.key === 'Enter' ? end(ctx) : undefined),
        onCancel: () => ({ to: 'idle' }),
        // however it is left (ended, Esc, another tool picked mid-path), the path so far goes
        onExit: (ctx) => {
          ctx.session.sketch.set(undefined);
          vertices = [];
        },
      },
    },
  };
}
