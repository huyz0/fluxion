import { apply, type Mat2d } from './mat2d.js';
import type { Vec2 } from './vec2.js';

/**
 * An axis-aligned rectangle; `w` and `h` are never negative.
 *
 * @public
 */
export type Box = {
  /** Left edge. */
  readonly x: number;
  /** Top edge. */
  readonly y: number;
  /** Width (≥ 0). */
  readonly w: number;
  /** Height (≥ 0). */
  readonly h: number;
};

/**
 * Smallest box containing every point, or `null` for an empty list.
 *
 * @public
 */
export function boxFromPoints(points: readonly Vec2[]): Box | null {
  const first = points[0];
  if (first === undefined) return null;
  let minX = first.x;
  let minY = first.y;
  let maxX = first.x;
  let maxY = first.y;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Smallest box containing both boxes.
 *
 * @public
 */
export function boxUnion(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/**
 * True when `p` lies inside or on the edge of `box`.
 *
 * @public
 */
export function boxContains(box: Box, p: Vec2): boolean {
  return p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h;
}

/**
 * True when `inner` lies entirely inside `outer` (shared edges count as inside).
 *
 * @public
 */
export function boxContainsBox(outer: Box, inner: Box): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

/**
 * True when the boxes overlap or touch.
 *
 * @public
 */
export function boxIntersects(a: Box, b: Box): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

/**
 * Overlapping region of two boxes, or `null` when they do not overlap or touch.
 *
 * @public
 */
export function boxIntersection(a: Box, b: Box): Box | null {
  if (!boxIntersects(a, b)) return null;
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return { x, y, w: Math.min(a.x + a.w, b.x + b.w) - x, h: Math.min(a.y + a.h, b.y + b.h) - y };
}

/**
 * Grows the box by `dx` on the left and right and `dy` (default `dx`) on the top and bottom;
 * negative amounts shrink it, never below zero size (it collapses onto its centre).
 *
 * @public
 */
export function boxInflate(box: Box, dx: number, dy: number = dx): Box {
  const w = Math.max(0, box.w + 2 * dx);
  const h = Math.max(0, box.h + 2 * dy);
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

/**
 * Centre point of the box.
 *
 * @public
 */
export function boxCenter(box: Box): Vec2 {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

/**
 * The four corners in order top-left, top-right, bottom-right, bottom-left.
 *
 * @public
 */
export function boxCorners(box: Box): readonly [Vec2, Vec2, Vec2, Vec2] {
  const right = box.x + box.w;
  const bottom = box.y + box.h;
  return [
    { x: box.x, y: box.y },
    { x: right, y: box.y },
    { x: right, y: bottom },
    { x: box.x, y: bottom },
  ];
}

/**
 * Axis-aligned bounds of `box` after transforming its corners by `m`.
 *
 * @public
 */
export function transformBox(m: Mat2d, box: Box): Box {
  const [a, b, c, d] = boxCorners(box);
  const corners = [apply(m, a), apply(m, b), apply(m, c), apply(m, d)];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of corners) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
