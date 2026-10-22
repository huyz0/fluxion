// The `pins`, `fit` and `snap` post-passes (ADR-0033, ADR-0034, FR-LAY-004, FR-LAY-008, FR-LAY-012): pure functions over the boxes an algorithm
// returned. The pipeline runs them in the fixed order pins, constraints, overlap, fit, snap (`fit` only when asked for); `pins` first so that whatever an algorithm did to a pinned node is undone before
// anything else looks at the boxes, `snap` last so that rounding is the final step and cannot be undone by another pass.
import type { Box } from '@fluxion/geometry';
import type { LayoutInput } from './types.js';

/**
 * Boxes by node id, as an algorithm returns them and a post-pass takes them.
 *
 * @public
 */
export type Boxes = { readonly [id: string]: Box };

/**
 * The names of the post-passes, in the order the pipeline runs them.
 *
 * @public
 */
export type PostPassId = 'pins' | 'constraints' | 'overlap' | 'fit' | 'snap';

/** Rounds a coordinate to the half pixel, halves toward +infinity, `-0` as `0` (ADR-0034). */
const quantize = (v: number): number => Math.round(v * 2) / 2 + 0;

/**
 * Put every pinned node back on its input box and drop boxes for ids that are not in the input. A pinned node never moves, whatever the
 * algorithm did; an unpinned node the algorithm forgot is left out (the pipeline decides what to do with it).
 *
 * @public
 */
export function applyPins(input: LayoutInput, boxes: Boxes): Boxes {
  const known = new Map(input.nodes.map((n) => [n.id, n] as const));
  const out = new Map<string, Box>();
  for (const [id, box] of Object.entries(boxes)) {
    const node = known.get(id);
    if (node) out.set(id, node.pinned ? node.box : box);
  }
  for (const n of input.nodes) if (n.pinned) out.set(n.id, n.box);
  return Object.fromEntries(out);
}

/**
 * Round the position of every unpinned box to the half pixel. Sizes and pinned boxes keep their exact values (ADR-0034): a pinned box is the
 * document's own placement, and a size comes from the content, not from layout.
 *
 * @public
 */
export function snapBoxes(input: LayoutInput, boxes: Boxes): Boxes {
  const pinned = new Set(input.nodes.filter((n) => n.pinned).map((n) => n.id));
  return Object.fromEntries(Object.entries(boxes).map(([id, b]) => [id, pinned.has(id) ? b : { x: quantize(b.x), y: quantize(b.y), w: b.w, h: b.h }]));
}

/**
 * Options of the `fit` pass.
 *
 * @public
 */
export type FitOptions = {
  /** The margin between the frame's edge and its safe area, px (default 5% of the frame's smaller side). */
  readonly margin?: number | undefined;
};

/** The default margin of the safe area: this share of the frame's smaller side. */
const SAFE_SHARE = 0.05;
/** Kept free inside the safe area, px, so a later 1 px overlap nudge or `snap`'s half-pixel rounding cannot carry a box out of it. */
const SNAP_ROOM = 2;

/**
 * The safe area of a frame: the frame inset by `margin` (default 5% of its smaller side) on every side.
 *
 * @public
 */
export function safeAreaOf(frame: Box, options: FitOptions = {}): Box {
  const margin = Math.min(Math.max(0, options.margin ?? SAFE_SHARE * Math.min(frame.w, frame.h)), frame.w / 2, frame.h / 2);
  return { x: frame.x + margin, y: frame.y + margin, w: frame.w - 2 * margin, h: frame.h - 2 * margin };
}

/** The start that puts a span of `size` inside `[lo, lo + room]` with the least move from `start` (centred when it cannot fit). */
const placed = (start: number, size: number, lo: number, room: number): number =>
  size >= room ? lo + (room - size) / 2 : Math.min(Math.max(start, lo), lo + room - size);

/** How a set of boxes is fitted: the unpinned ones, their bounds' top-left corner, the scale and where that corner goes. */
type Fitting = {
  readonly free: ReadonlyArray<readonly [string, Box]>;
  readonly from: readonly [number, number];
  readonly scale: number;
  readonly to: readonly [number, number];
};

/** The fitting of `boxes`, or undefined when there is nothing to do: no unpinned box, all already inside, or a safe area with no room. */
function fittingOf(input: LayoutInput, boxes: Boxes, options: FitOptions): Fitting | undefined {
  const pinned = new Set(input.nodes.filter((n) => n.pinned).map((n) => n.id));
  const free = Object.entries(boxes).filter(([id]) => !pinned.has(id));
  if (free.length === 0) return undefined;
  const safe = safeAreaOf(input.frame, options);
  const [left, top] = [Math.min(...free.map(([, b]) => b.x)), Math.min(...free.map(([, b]) => b.y))];
  const [right, bottom] = [Math.max(...free.map(([, b]) => b.x + b.w)), Math.max(...free.map(([, b]) => b.y + b.h))];
  if (left >= safe.x && top >= safe.y && right <= safe.x + safe.w && bottom <= safe.y + safe.h) return undefined;
  const [ix, iy] = [Math.min(SNAP_ROOM, safe.w / 2), Math.min(SNAP_ROOM, safe.h / 2)];
  const room = { x: safe.x + ix, y: safe.y + iy, w: safe.w - 2 * ix, h: safe.h - 2 * iy };
  // a safe area with no room would scale the content to nothing: it is left as it is
  if (room.w <= 0 || room.h <= 0) return undefined;
  const scale = Math.min(1, right > left ? room.w / (right - left) : 1, bottom > top ? room.h / (bottom - top) : 1);
  return { free, from: [left, top], scale, to: [placed(left, (right - left) * scale, room.x, room.w), placed(top, (bottom - top) * scale, room.y, room.h)] };
}

/**
 * The scale `fitBoxes` would apply to `boxes`: 1 when it would not scale them.
 *
 * @public
 */
export function fitScaleOf(input: LayoutInput, boxes: Boxes, options: FitOptions = {}): number {
  return fittingOf(input, boxes, options)?.scale ?? 1;
}

/**
 * Fit the unpinned boxes into the frame's safe area (FR-LAY-012): scaled down together, never up, about their bounds, then moved by the least
 * amount that puts their bounds inside. Content already inside is left alone, and so is content when the safe area has no room; pinned boxes
 * never change.
 *
 * @public
 */
export function fitBoxes(input: LayoutInput, boxes: Boxes, options: FitOptions = {}): Boxes {
  const fitting = fittingOf(input, boxes, options);
  if (!fitting) return boxes;
  const { free, from, scale, to } = fitting;
  const out: Record<string, Box> = { ...boxes };
  for (const [id, b] of free) out[id] = { x: to[0] + (b.x - from[0]) * scale, y: to[1] + (b.y - from[1]) * scale, w: b.w * scale, h: b.h * scale };
  return out;
}
