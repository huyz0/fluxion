// Quick-connect (FR-EDT-015): a hovered shape (not a selected one) shows a "+" beyond the middle of each side; a drag from one draws a connector from
// that side. Dropped on another element it joins the two; dropped on nothing it opens the mini library, whose choice adds a new
// shape there joined to the first, or the connector alone with its end free. Either way one undo step.

import type { ReadView } from '@fluxion/core';
import { apply, elementMatrix, invert, type Vec2 } from '@fluxion/geometry';
import type { AnyRecord, RecordId } from '@fluxion/schema';
import { type Camera, pageToScreen } from './camera.js';
import { anchorAt, createConnector, endTarget, showAnchors } from './connector-tool.js';
import { frontIndex, shapeMaker } from './create-tool.js';
import type { PointerInfo } from './pointer.js';
import { DRAG_PX } from './selection.js';
import type { QuickDrop } from './session.js';
import { SELECT_TOOL, type StateNode, type ToolCtx } from './tools.js';

/** How far beyond a side's middle its "+" sits, screen px. */
export const QUICK_OFFSET_PX = 22;
/** How near the pointer must be to a "+" to press it, screen px. */
export const QUICK_RADIUS_PX = 10;

type Side = QuickDrop['side'];

/** One "+" of a shape: its side, the side's middle and the "+" itself, page units. */
export type QuickHandle = { readonly side: Side; readonly edge: Vec2; readonly at: Vec2 };

type Placed = {
  readonly kind?: unknown;
  readonly hidden?: unknown;
  readonly defId?: unknown;
  readonly transform?: { x: number; y: number; w: number; h: number };
};

/** The middle of each side in the element's own box. */
const MIDDLES: readonly (readonly [Side, number, number])[] = [
  ['n', 0.5, 0],
  ['e', 1, 0.5],
  ['s', 0.5, 1],
  ['w', 0, 0.5],
];

/** The "+" handles of the shape `id` at `camera` (none for anything but a visible shape). */
export function quickHandles(view: ReadView, id: RecordId | undefined, camera: Camera): readonly QuickHandle[] {
  const r = id === undefined ? undefined : (view.get(id) as Placed | undefined);
  const t = r?.transform;
  if (r?.kind !== 'shape' || r.hidden === true || t === undefined) return [];
  const m = elementMatrix({ rot: 0, ...t });
  const centre = apply(m, { x: t.w / 2, y: t.h / 2 });
  return MIDDLES.map(([side, u, v]) => {
    const edge = apply(m, { x: u * t.w, y: v * t.h });
    const [dx, dy] = [edge.x - centre.x, edge.y - centre.y];
    const len = Math.hypot(dx, dy) || 1;
    const out = QUICK_OFFSET_PX / camera.z;
    return { side, edge, at: { x: edge.x + (dx / len) * out, y: edge.y + (dy / len) * out } };
  });
}

/** The shape whose "+" handles show: the hovered one, unless it is selected (its frame's handles are there, the rotate one above). */
export function quickSource(hover: RecordId | undefined, selection: readonly RecordId[]): RecordId | undefined {
  return hover === undefined || selection.includes(hover) ? undefined : hover;
}

/** The "+" of the hovered shape under the pointer, if any. */
export function quickHandleAt(ctx: ToolCtx, e: PointerInfo): (QuickHandle & { readonly source: RecordId }) | undefined {
  const source = quickSource(ctx.session.hover.get(), ctx.session.selection.get());
  const camera = ctx.session.camera.get();
  const near = quickHandles(ctx.view, source, camera).find((h) => {
    const p = pageToScreen(camera, h.at);
    return Math.hypot(p.x - e.screen.x, p.y - e.screen.y) <= QUICK_RADIUS_PX;
  });
  return near === undefined || source === undefined ? undefined : { ...near, source };
}

/** Whether page point `p` is within reach of the "+" handles of `id`: in its box grown by their offset and radius. */
function nearHandles(view: ReadView, id: RecordId, p: Vec2, camera: Camera): boolean {
  const t = (view.get(id) as Placed | undefined)?.transform;
  const m = t === undefined ? undefined : invert(elementMatrix({ rot: 0, ...t }));
  if (t === undefined || m === undefined || !m.ok) return false;
  const local = apply(m.value, p);
  const reach = (QUICK_OFFSET_PX + QUICK_RADIUS_PX) / camera.z;
  return local.x >= -reach && local.y >= -reach && local.x <= t.w + reach && local.y <= t.h + reach;
}

/**
 * What the select tool hovers at a move: what is hit; on nothing, the shape showing "+" handles still while the pointer is within
 * their reach (crossing from the shape to a "+" does not lose them).
 */
export function hoverAt(ctx: ToolCtx, e: PointerInfo): RecordId | undefined {
  const hit = ctx.hitTest(e.page);
  if (hit !== undefined) return hit;
  const source = quickSource(ctx.session.hover.get(), ctx.session.selection.get());
  return source !== undefined &&
    quickHandles(ctx.view, source, ctx.session.camera.get()).length > 0 &&
    nearHandles(ctx.view, source, e.page, ctx.session.camera.get())
    ? source
    : undefined;
}

const clear = (ctx: ToolCtx) => {
  ctx.session.sketch.set(undefined);
  ctx.session.hover.set(undefined);
  ctx.session.anchors.set([]);
};

/** The select tool's quick-connect drag, entered from a press on a "+" (its handle as the info). */
export function quickConnecting(): StateNode {
  let press: (QuickHandle & { readonly source: RecordId }) | undefined;
  return {
    id: 'quickConnecting',
    onEnter: (ctx, info) => {
      press = info as typeof press;
      if (press !== undefined) ctx.session.sketch.set([press.edge, press.edge]);
    },
    onPointerMove: (ctx, e) => {
      if (press === undefined) return undefined;
      ctx.session.sketch.set([press.edge, e.page]);
      const over = endTarget(ctx, e.page);
      const target = over === press.source ? undefined : over;
      ctx.session.hover.set(target);
      showAnchors(ctx, target, e.page);
      return undefined;
    },
    onPointerUp: (ctx, e) => {
      clear(ctx);
      const from = press;
      press = undefined;
      if (from === undefined) return { to: 'idle' };
      const z = ctx.session.camera.get().z;
      if (Math.hypot(e.page.x - from.edge.x, e.page.y - from.edge.y) * z < DRAG_PX) return { to: 'idle' };
      const target = endTarget(ctx, e.page);
      const anchors = { source: anchorAt(ctx, from.source, from.edge) };
      if (target !== undefined && target !== from.source)
        createConnector(ctx, {
          from: from.edge,
          to: e.page,
          source: from.source,
          target,
          curved: false,
          anchors: { ...anchors, target: anchorAt(ctx, target, e.page) },
        });
      // dropped on nothing (or back on the shape): the mini library says what goes there
      else if (target === undefined) ctx.session.quickDrop.set({ source: from.source, side: from.side, from: from.edge, at: e.page, screen: e.screen });
      return { to: 'idle' };
    },
    onCancel: (ctx) => {
      clear(ctx);
      press = undefined;
      return { to: 'idle' };
    },
  };
}

/** The box of a `size` shape whose side facing the drop's source has its middle at the drop point. */
function boxAt(drop: QuickDrop, size: { readonly w: number; readonly h: number }) {
  const [dx, dy] = [drop.at.x - drop.from.x, drop.at.y - drop.from.y];
  const { w, h } = size;
  // the side faced is the one the drag mostly went towards
  if (Math.abs(dx) >= Math.abs(dy)) return { x: dx >= 0 ? drop.at.x : drop.at.x - w, y: drop.at.y - h / 2, w, h };
  return { x: drop.at.x - w / 2, y: dy >= 0 ? drop.at.y : drop.at.y - h, w, h };
}

/**
 * Finish the dropped quick-connect `drop`: with `defId`, a new shape of that definition (`size`) at the drop point, joined to the
 * source by a connector, the new shape selected; without, the connector alone, its end free at the drop point. One undo step; the
 * new element's id, or undefined when nothing was added.
 */
export function finishQuickDrop(
  ctx: ToolCtx,
  drop: QuickDrop,
  choice?: { readonly defId: string; readonly size: { readonly w: number; readonly h: number } },
): RecordId | undefined {
  ctx.session.quickDrop.set(undefined);
  const link = { from: drop.from, to: drop.at, source: drop.source, curved: false, anchors: { source: anchorAt(ctx, drop.source, drop.from) } };
  if (choice === undefined) return createConnector(ctx, { ...link, target: undefined });
  const index = ctx.screen === undefined ? undefined : frontIndex(ctx.view, ctx.screen);
  if (ctx.screen === undefined || index === undefined) return undefined;
  const id = ctx.newId();
  const mergeKey = `quick:${id}`;
  const shape = shapeMaker(choice.defId)({ id, screenId: ctx.screen, index, transform: boxAt(drop, choice.size) }) as AnyRecord;
  if (!ctx.execute('element.create', { element: shape }, { mergeKey }).ok) return undefined;
  // the connector and its bindings join the shape's step: its own key would close it
  createConnector(
    { ...ctx, seal: () => undefined, execute: (c, a, o) => ctx.execute(c, a, { ...o, mergeKey }) },
    {
      ...link,
      target: id,
      anchors: { ...link.anchors, target: anchorAt(ctx, id, drop.at) },
    },
  );
  ctx.seal();
  // the new shape is selected (createConnector selected the connector)
  ctx.session.selection.set([id]);
  ctx.session.tool.set(SELECT_TOOL);
  return id;
}

/** The definition and size the "same shape" line adds: the source's own. */
export function sameAs(view: ReadView, source: RecordId): { readonly defId: string; readonly size: { readonly w: number; readonly h: number } } | undefined {
  const r = view.get(source) as Placed | undefined;
  return typeof r?.defId === 'string' && r.transform !== undefined ? { defId: r.defId, size: { w: r.transform.w, h: r.transform.h } } : undefined;
}
