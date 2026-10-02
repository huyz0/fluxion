// Resizing and rotating (FR-EDT-004): a handle drags the edges it sits on, in the box's own turned
// frame, the opposite side staying put (alt: the centre stays put; shift: the aspect is kept); the
// rotate handle turns the box about its centre (shift: in 15° steps). Pure: the select tool turns the
// result into element.updateMany.
import type { Vec2 } from '@fluxion/geometry';
import { type Box2, HANDLES, type HandleId } from './overlay-geometry.js';

export type { Box2 } from './overlay-geometry.js';

/**
 * The least width and height a resize leaves, page units.
 *
 * @public
 */
export const MIN_SIZE = 1;

/**
 * The step shift snaps a rotation to, degrees.
 *
 * @public
 */
export const ROTATE_STEP = 15;

/** Which edges of the box each handle moves: -1 the low edge, 1 the high edge, 0 neither, per axis. */
export const EDGES: { readonly [H in HandleId]: readonly [-1 | 0 | 1, -1 | 0 | 1] } = {
  nw: [-1, -1],
  n: [0, -1],
  ne: [1, -1],
  e: [1, 0],
  se: [1, 1],
  s: [0, 1],
  sw: [-1, 1],
  w: [-1, 0],
};

const radians = (deg: number) => (deg * Math.PI) / 180;

/** `v` turned by `deg` degrees clockwise (y down). */
const turn = (v: Vec2, deg: number): Vec2 => {
  const c = Math.cos(radians(deg));
  const s = Math.sin(radians(deg));
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
};

/** The new extent `[lo, hi]` along one axis of size `size`, its `edge` dragged to `to` (about the centre with alt). */
function extent(edge: -1 | 0 | 1, size: number, to: number, alt: boolean): readonly [number, number] {
  if (edge === 0) return [0, size];
  if (alt) {
    const half = Math.max(Math.abs(to - size / 2), MIN_SIZE / 2);
    return [size / 2 - half, size / 2 + half];
  }
  // the opposite edge stays; the dragged one stops MIN_SIZE short of it
  // tzap disable next-line EqualityOperator: an edge of 0 has returned above
  return edge < 0 ? [Math.min(to, size - MIN_SIZE), size] : [0, Math.max(to, MIN_SIZE)];
}

/** `[lo, hi]` scaled by `k` about the end that stays (the centre with alt). */
function scaled(
  range: readonly [number, number],
  edge: -1 | 0 | 1,
  size: number,
  by: { readonly k: number; readonly alt: boolean },
): readonly [number, number] {
  const length = size * by.k;
  if (by.alt || edge === 0) return [size / 2 - length / 2, size / 2 + length / 2];
  // tzap disable next-line EqualityOperator: an edge of 0 has returned above
  return edge < 0 ? [range[1] - length, range[1]] : [range[0], range[0] + length];
}

/**
 * Where the handle `handle` of `box` is on the page (its turn included).
 *
 * @public
 */
export function handlePoint(box: Box2, handle: HandleId): Vec2 {
  const [, u, v] = HANDLES.find(([id]) => id === handle) as readonly [HandleId, number, number];
  const r = (box.rot * Math.PI) / 180;
  const dx = (u - 0.5) * box.w;
  const dy = (v - 0.5) * box.h;
  return { x: box.x + box.w / 2 + dx * Math.cos(r) - dy * Math.sin(r), y: box.y + box.h / 2 + dx * Math.sin(r) + dy * Math.cos(r) };
}

/**
 * `box` with the handle `handle` dragged to page point `to`.
 *
 * @public
 */
export function resize(box: Box2, handle: HandleId, to: Vec2, mods: { readonly shift: boolean; readonly alt: boolean }): Box2 {
  const [ex, ey] = EDGES[handle];
  const centre = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  // the pointer in the box's own frame, from its top-left corner
  const local = turn({ x: to.x - centre.x, y: to.y - centre.y }, -box.rot);
  let xs = extent(ex, box.w, local.x + box.w / 2, mods.alt);
  let ys = extent(ey, box.h, local.y + box.h / 2, mods.alt);
  if (mods.shift) {
    // the aspect kept: the side dragged furthest decides, a side handle scales the other side too
    const kx = (xs[1] - xs[0]) / box.w;
    const ky = (ys[1] - ys[0]) / box.h;
    const k = ex === 0 ? ky : ey === 0 ? kx : Math.max(kx, ky);
    xs = scaled(xs, ex, box.w, { k, alt: mods.alt });
    ys = scaled(ys, ey, box.h, { k, alt: mods.alt });
  }
  const w = xs[1] - xs[0];
  const h = ys[1] - ys[0];
  // the new centre, from the old one through the box's frame
  const moved = turn({ x: (xs[0] + xs[1]) / 2 - box.w / 2, y: (ys[0] + ys[1]) / 2 - box.h / 2 }, box.rot);
  return { x: centre.x + moved.x - w / 2, y: centre.y + moved.y - h / 2, w, h, rot: box.rot };
}

/**
 * Where page point `p`, at a place in the frame `from`, lands at the same place in the frame `to`
 * (its fractions of the width and height, in the frame's own turn).
 *
 * @public
 */
export function carry(from: Box2, to: Box2, p: Vec2): Vec2 {
  const local = turn({ x: p.x - (from.x + from.w / 2), y: p.y - (from.y + from.h / 2) }, -from.rot);
  const sx = from.w === 0 ? 1 : to.w / from.w;
  const sy = from.h === 0 ? 1 : to.h / from.h;
  const back = turn({ x: local.x * sx, y: local.y * sy }, to.rot);
  return { x: to.x + to.w / 2 + back.x, y: to.y + to.h / 2 + back.y };
}

/**
 * The turn of `box` after the rotate handle, grabbed at page point `from`, is dragged to `to`: the
 * angle swept about the box's centre, in 15° steps with shift, within [0, 360).
 *
 * @public
 */
export function rotation(box: Box2, from: Vec2, to: Vec2, shift: boolean): number {
  const centre = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  const angle = (p: Vec2) => (Math.atan2(p.y - centre.y, p.x - centre.x) * 180) / Math.PI;
  const turned = box.rot + angle(to) - angle(from);
  const stepped = shift ? Math.round(turned / ROTATE_STEP) * ROTATE_STEP : turned;
  return ((stepped % 360) + 360) % 360;
}
