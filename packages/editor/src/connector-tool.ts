// The connector tool (FR-EDT-003, FR-CON-001): a drag from an element to another joins them with a
// connector bound at both ends; an end within the snap tolerance of an anchor that is not full binds
// there, any other end on an element binds `auto` (FR-ANC-006, FR-ANC-003); an end dropped on nothing,
// or on a connector, stays free at that point. The route is straight, or curved with alt held at the
// release. While dragging, the overlay draws the line (the session's sketch), hovers the element the
// drop would bind and shows its anchors, the one a drop would snap to marked. The connector and its
// bindings are written under one merge key: one undo step.
import type { Vec2 } from '@fluxion/geometry';
import type { AnchorRef, AnyRecord, RecordId } from '@fluxion/schema';
import { anchorDots, type EndRef, snapAnchor } from './anchor-snap.js';
import { type CreateDeps, frontIndex } from './create-tool.js';
import { DRAG_PX } from './selection.js';
import { snapThreshold } from './snap/snap.js';
import { SELECT_TOOL, type Tool, type ToolCtx } from './tools.js';

/**
 * What a connector drag joins: its ends as page points, the elements they bind (if any), and its
 * route's kind.
 *
 * @public
 */
export type Link = {
  /** Where the drag started. */
  readonly from: Vec2;
  /** Where it ended. */
  readonly to: Vec2;
  /** The element the source end binds, if any. */
  readonly source: RecordId | undefined;
  /** The element the target end binds, if any. */
  readonly target: RecordId | undefined;
  /** A curved route rather than a straight one. */
  readonly curved: boolean;
  /** The anchors the ends bind at (absent: `auto`). */
  readonly anchors?:
    | {
        /** The source end's anchor. */
        readonly source?: AnchorRef | undefined;
        /** The target end's anchor. */
        readonly target?: AnchorRef | undefined;
      }
    | undefined;
};

/** The element a connector end at `id` binds: any hit element but a connector (also where a dragged end lands). */
export function bindable(ctx: ToolCtx, id: RecordId | undefined): RecordId | undefined {
  const r = id === undefined ? undefined : (ctx.view.get(id) as { readonly kind?: unknown } | undefined);
  return r === undefined || r.kind === 'connector' ? undefined : id;
}

/** The anchor a connector end at `p` on `elementId` binds: snapped within the tolerance at the current zoom, else `auto`; `except` is the connector end being re-pointed. */
export function anchorAt(ctx: ToolCtx, elementId: RecordId, p: Vec2, except?: EndRef): AnchorRef {
  if (ctx.shapeDefs === undefined) return { kind: 'auto' };
  return snapAnchor(ctx.view, ctx.shapeDefs, { elementId, at: p, tolerance: snapThreshold(ctx.session.camera.get().z), except });
}

/**
 * The element a connector end at `p` binds: the one hit there, else (the end just outside every outline, where the anchors on it are
 * still within the snap tolerance) the element near `p` with an anchor `p` would snap to, nearest first. `except` is the connector
 * end being re-pointed.
 */
export function endTarget(ctx: ToolCtx, p: Vec2, except?: EndRef): RecordId | undefined {
  const hit = bindable(ctx, ctx.hitTest(p));
  if (hit !== undefined || ctx.shapeDefs === undefined) return hit;
  const defs = ctx.shapeDefs;
  const tolerance = snapThreshold(ctx.session.camera.get().z);
  const near = ctx.elementsIn({ x: p.x - tolerance, y: p.y - tolerance, w: 2 * tolerance, h: 2 * tolerance }, 'intersect');
  const snapped = near
    .filter((id) => bindable(ctx, id) !== undefined)
    .flatMap((id) => {
      const dot = anchorDots(ctx.view, defs, { elementId: id, at: p, tolerance, except }).find((d) => d.snapped);
      return dot === undefined ? [] : [{ id, d: Math.hypot(dot.point.x - p.x, dot.point.y - p.y) }];
    });
  return snapped.reduce<(typeof snapped)[number] | undefined>((best, c) => (best === undefined || c.d < best.d ? c : best), undefined)?.id;
}

/** Show the anchors of `elementId` (none when undefined) for a connector end at `p` (FR-ANC-006). */
export function showAnchors(ctx: ToolCtx, elementId: RecordId | undefined, p: Vec2, except?: EndRef): void {
  const tolerance = snapThreshold(ctx.session.camera.get().z);
  ctx.session.anchors.set(
    elementId === undefined || ctx.shapeDefs === undefined ? [] : anchorDots(ctx.view, ctx.shapeDefs, { elementId, at: p, tolerance, except }),
  );
}

/**
 * Add the connector `link` describes, bound where it binds, in one undo step; select it and go back to
 * the select tool. Its id, or undefined when nothing was added.
 *
 * @public
 */
export function createConnector(deps: CreateDeps, link: Link): RecordId | undefined {
  const index = deps.screen === undefined ? undefined : frontIndex(deps.view, deps.screen);
  // tzap disable next-line ConditionalExpression: without a screen there is no index either
  if (deps.screen === undefined || index === undefined) return undefined;
  const id = deps.newId();
  // tzap disable next-line StringLiteral: any key groups these writes; the seal below ends the step
  const mergeKey = `create:${id}`;
  const connector = {
    id,
    type: 'element',
    screenId: deps.screen,
    index,
    kind: 'connector',
    route: { type: link.curved ? 'curved' : 'straight' },
    markers: { end: 'arrow' },
    freeSource: link.from,
    freeTarget: link.to,
  } as unknown as AnyRecord;
  const made = deps.execute('element.create', { element: connector }, { mergeKey });
  if (made.ok) {
    // a binding refused leaves that end free where it was dropped
    const ends = [
      ['source', link.source],
      ['target', link.target],
    ] as const;
    for (const [end, elementId] of ends)
      if (elementId !== undefined)
        deps.execute('binding.set', { id: deps.newId(), connectorId: id, end, elementId, anchor: link.anchors?.[end] ?? { kind: 'auto' } }, { mergeKey });
  }
  // tzap disable next-line CallExpression: the next write's own key starts a new step anyway; sealed like every tool write
  deps.seal();
  if (!made.ok) return undefined;
  deps.session.selection.set([id]);
  deps.session.tool.set(SELECT_TOOL);
  return id;
}

/**
 * The connector tool (C).
 *
 * @public
 */
export function connectorTool(): Tool {
  const drag = { from: { x: 0, y: 0 }, source: undefined as RecordId | undefined, anchor: undefined as AnchorRef | undefined };
  const clear = (ctx: ToolCtx) => {
    ctx.session.sketch.set(undefined);
    ctx.session.hover.set(undefined);
    ctx.session.anchors.set([]);
  };
  return {
    id: 'connector',
    title: 'Connector',
    shortcut: 'c',
    initial: 'idle',
    states: {
      idle: {
        id: 'idle',
        onPointerDown: (ctx, e) => {
          if (e.button !== 0) return undefined;
          drag.from = e.page;
          drag.source = endTarget(ctx, e.page);
          drag.anchor = drag.source === undefined ? undefined : anchorAt(ctx, drag.source, e.page);
          // the anchors of the element pressed show from the press, the one the source end took marked
          showAnchors(ctx, drag.source, e.page);
          return { to: 'linking' };
        },
      },
      linking: {
        id: 'linking',
        onPointerMove: (ctx, e) => {
          ctx.session.sketch.set([drag.from, e.page]);
          const over = endTarget(ctx, e.page);
          ctx.session.hover.set(over);
          // back over the source, its dots are as at the press: its end is already placed there
          showAnchors(ctx, over, over !== undefined && over === drag.source ? drag.from : e.page);
          return undefined;
        },
        onPointerUp: (ctx, e) => {
          clear(ctx);
          const far = Math.hypot(e.page.x - drag.from.x, e.page.y - drag.from.y) * ctx.session.camera.get().z >= DRAG_PX;
          const target = endTarget(ctx, e.page);
          // a click links nothing; nor does a drag from an element back onto it
          if (far && (target === undefined || target !== drag.source))
            createConnector(ctx, {
              from: drag.from,
              to: e.page,
              source: drag.source,
              target,
              curved: e.alt,
              anchors: { source: drag.anchor, target: target === undefined ? undefined : anchorAt(ctx, target, e.page) },
            });
          return { to: 'idle' };
        },
        onCancel: (ctx) => {
          clear(ctx);
          return { to: 'idle' };
        },
      },
    },
  };
}
