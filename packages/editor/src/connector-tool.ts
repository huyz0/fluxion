// The connector tool (FR-EDT-003, FR-CON-001): a drag from an element to another joins them with a
// connector bound at both ends (auto anchors); an end dropped on nothing, or on a connector, stays
// free at that point. The route is straight, or curved with alt held at the release. While dragging,
// the overlay draws the line (the session's sketch) and hovers the element the drop would bind. The
// connector and its bindings are written under one merge key: one undo step.
import type { Vec2 } from '@fluxion/geometry';
import type { AnyRecord, RecordId } from '@fluxion/schema';
import { type CreateDeps, frontIndex } from './create-tool.js';
import { DRAG_PX } from './selection.js';
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
};

/** The element a connector end at `id` binds: any hit element but a connector (also where a dragged end lands). */
export function bindable(ctx: ToolCtx, id: RecordId | undefined): RecordId | undefined {
  const r = id === undefined ? undefined : (ctx.view.get(id) as { readonly kind?: unknown } | undefined);
  return r === undefined || r.kind === 'connector' ? undefined : id;
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
      if (elementId !== undefined) deps.execute('binding.set', { id: deps.newId(), connectorId: id, end, elementId, anchor: { kind: 'auto' } }, { mergeKey });
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
  const drag = { from: { x: 0, y: 0 }, source: undefined as RecordId | undefined };
  const clear = (ctx: ToolCtx) => {
    ctx.session.sketch.set(undefined);
    ctx.session.hover.set(undefined);
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
          drag.source = bindable(ctx, ctx.hitTest(e.page));
          return { to: 'linking' };
        },
      },
      linking: {
        id: 'linking',
        onPointerMove: (ctx, e) => {
          ctx.session.sketch.set([drag.from, e.page]);
          ctx.session.hover.set(bindable(ctx, ctx.hitTest(e.page)));
          return undefined;
        },
        onPointerUp: (ctx, e) => {
          clear(ctx);
          const far = Math.hypot(e.page.x - drag.from.x, e.page.y - drag.from.y) * ctx.session.camera.get().z >= DRAG_PX;
          const target = bindable(ctx, ctx.hitTest(e.page));
          // a click links nothing; nor does a drag from an element back onto it
          if (far && (target === undefined || target !== drag.source))
            createConnector(ctx, { from: drag.from, to: e.page, source: drag.source, target, curved: e.alt });
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
