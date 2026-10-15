// The `overlap` post-pass (ADR-0034, FR-LAY-004): after it, no unpinned box overlaps another box or comes within `margin` px of one, and no box
// has moved but an unpinned one. Stage 1 separates overlapping pairs in a few fixed passes, moving the later box of a pair along the axis of
// least penetration; stage 2 moves any unpinned box that still touches another to the nearest free place of a fixed candidate list, and, when
// none is free, past the bounding box of everything, a place that is always free. Everything is in canonical order (model order, then id), with
// no randomness, so the result is deterministic. Two pinned boxes that overlap are the document's own placement: they stay, and `overlapCount` counts them.
import type { Box } from '@fluxion/geometry';
import type { Boxes } from './passes.js';
import type { LayoutInput } from './types.js';

/**
 * Options of the overlap pass.
 *
 * @public
 */
export type OverlapOptions = {
  /** The space left between any two boxes, px, 0 or more (default 1: it absorbs text-measurement drift and the half-pixel rounding of `snap`; anything else is read as 1). */
  readonly margin?: number;
  /** The axis along which a pair is separated; the axis of least penetration when omitted. `layered` sets the axis its ranks are spread along. */
  readonly preferAxis?: 'x' | 'y';
};

const PASSES = 8;
/** Rings of candidate places tried around a box before it goes past everything. */
const RINGS = 8;
/** An overlap shorter than this is rounding noise, not an overlap. */
const EPSILON = 1e-9;
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

/** How far two spans overlap (negative: the gap between them). */
const lap = (aStart: number, aLen: number, bStart: number, bLen: number): number => Math.min(aStart + aLen, bStart + bLen) - Math.max(aStart, bStart);

/** True when `a` and `b` overlap or are closer than `margin`. */
function touches(a: Box, b: Box, margin: number): boolean {
  return lap(a.x, a.w, b.x, b.w) + margin > EPSILON && lap(a.y, a.h, b.y, b.h) + margin > EPSILON;
}

type Item = { readonly id: string; readonly pinned: boolean };

/** The nodes that have a box, in canonical order. */
function itemsOf(input: LayoutInput, boxes: Boxes): Item[] {
  return [...input.nodes]
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .filter((n) => Object.hasOwn(boxes, n.id))
    .map((n) => ({ id: n.id, pinned: n.pinned === true }));
}

/** `b` moved along one axis. */
const shifted = (b: Box, axis: 'x' | 'y', by: number): Box => (axis === 'x' ? { ...b, x: b.x + by } : { ...b, y: b.y + by });

/** The shift that puts `mover` just clear of `anchor` along one axis (start, length), on the side the mover's centre is on. */
function clearance(mover: readonly [number, number], anchor: readonly [number, number], margin: number): number {
  const [m0, mLen] = mover;
  const [a0, aLen] = anchor;
  return m0 + mLen / 2 >= a0 + aLen / 2 ? a0 + aLen + margin - m0 : a0 - margin - mLen - m0;
}

/**
 * The box of `mover` pushed clear of `anchor` along the preferred axis, else along the axis that needs the shorter move, away from the anchor
 * (a box inside another is pushed all the way out, not just by the overlap).
 */
function separated(mover: Box, anchor: Box, margin: number, prefer: OverlapOptions['preferAxis']): Box {
  const sx = clearance([mover.x, mover.w], [anchor.x, anchor.w], margin);
  const sy = clearance([mover.y, mover.h], [anchor.y, anchor.h], margin);
  const axis = prefer ?? (Math.abs(sx) <= Math.abs(sy) ? 'x' : 'y');
  return shifted(mover, axis, axis === 'x' ? sx : sy);
}

type Resolved = Required<Pick<OverlapOptions, 'margin'>> & OverlapOptions;

/** Separates `a` and `b` if they touch: the later box moves unless it is pinned. Returns whether a box moved. */
function resolvePair(a: Item, b: Item, boxes: Map<string, Box>, o: Resolved): boolean {
  const [boxA, boxB] = [boxes.get(a.id) as Box, boxes.get(b.id) as Box];
  if ((a.pinned && b.pinned) || !touches(boxA, boxB, o.margin)) return false;
  const [mover, anchor] = b.pinned ? [a, b] : [b, a];
  boxes.set(mover.id, separated(boxes.get(mover.id) as Box, boxes.get(anchor.id) as Box, o.margin, o.preferAxis));
  return true;
}

/** Stage 1: a few passes over the pairs. Stops early once a pass moves nothing. */
function separate(items: readonly Item[], boxes: Map<string, Box>, o: Resolved): void {
  for (let pass = 0; pass < PASSES; pass += 1) {
    let moved = false;
    for (const [i, a] of items.entries()) {
      for (let j = i + 1; j < items.length; j += 1) moved = resolvePair(a, items[j] as Item, boxes, o) || moved;
    }
    if (!moved) return;
  }
}

/** True when `box` touches any box of `boxes` other than `self`. */
function crowded(box: Box, self: string, boxes: ReadonlyMap<string, Box>, margin: number): boolean {
  for (const [id, other] of boxes) if (id !== self && touches(box, other, margin)) return true;
  return false;
}

/** The nearest free place for `box`: the first of the candidates, by distance, that touches nothing, else past the bounding box of everything. */
function relocated(box: Box, self: string, boxes: ReadonlyMap<string, Box>, margin: number): Box {
  const candidates: Array<{ at: Box; d: number; k: number }> = [];
  for (let ring = 1; ring <= RINGS; ring += 1) {
    for (const [k, [dx, dy]] of DIRECTIONS.entries()) {
      const [ox, oy] = [dx * ring * (box.w + margin), dy * ring * (box.h + margin)];
      candidates.push({ at: { ...box, x: box.x + ox, y: box.y + oy }, d: ox * ox + oy * oy, k: ring * 8 + k });
    }
  }
  candidates.sort((a, b) => a.d - b.d || a.k - b.k);
  const free = candidates.find((c) => !crowded(c.at, self, boxes, margin));
  if (free) return free.at;
  let right = Number.NEGATIVE_INFINITY;
  for (const [id, b] of boxes) if (id !== self) right = Math.max(right, b.x + b.w);
  return { ...box, x: right + margin + 1 };
}

/**
 * Remove overlap from `boxes`: no unpinned box overlaps another box or comes within `margin` px of one. Pinned boxes and sizes never change.
 * Ids in `boxes` that are not in the input are ignored.
 *
 * @public
 */
export function removeOverlap(input: LayoutInput, boxes: Boxes, options: OverlapOptions = {}): Boxes {
  const given = options.margin;
  const margin = given !== undefined && Number.isFinite(given) && given >= 0 ? given : 1;
  const o = { ...options, margin };
  const items = itemsOf(input, boxes);
  const work = new Map(items.map((i) => [i.id, boxes[i.id] as Box] as const));
  separate(items, work, o);
  for (const item of items) {
    const box = work.get(item.id) as Box;
    if (!item.pinned && crowded(box, item.id, work, o.margin)) work.set(item.id, relocated(box, item.id, work, o.margin));
  }
  return Object.fromEntries(work);
}

/**
 * The number of pairs of boxes that overlap (pinned pairs included, no margin): `metrics.overlaps` of a result.
 *
 * @public
 */
export function overlapCount(boxes: Boxes): number {
  const all = Object.values(boxes);
  let count = 0;
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) if (touches(all[i] as Box, all[j] as Box, 0)) count += 1;
  }
  return count;
}
