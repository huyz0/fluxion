// Touch editing (FR-EDT-019): the recognizers' thresholds in one module, and what two fingers do to
// the camera. One finger is a pointer like any other (tap selects, drag moves, a handle resizes, with
// handles reached further for a finger); a second finger ends what the first began and pans and
// zooms the page about the two; a finger held still for LONG_PRESS_MS asks for the context menu. Pure:
// the canvas (canvas.tsx) keeps the fingers and the timer.
import type { Vec2 } from '@fluxion/geometry';
import { type Camera, clampZoom, screenToPage } from './camera.js';

/**
 * The touch recognizers' thresholds.
 *
 * @public
 */
export const TOUCH = {
  /** How long a finger held still asks for the context menu, ms. */
  longPressMs: 500,
  /** How far, in canvas px, a finger may drift and still be held still. */
  slopPx: 8,
  /** How far, in canvas px, a finger reaches a selection handle (a mouse: HANDLE_PX). */
  handlePx: 22,
} as const;

/** The midpoint of two points. */
const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * The camera after two fingers moved from `from` to `to` (canvas px), starting at `start`: the page
 * point under their midpoint stays under it, scaled by how far apart they now are (zoom clamped).
 *
 * @public
 */
export function pinchCamera(start: Camera, from: readonly [Vec2, Vec2], to: readonly [Vec2, Vec2]): Camera {
  const d0 = Math.hypot(from[1].x - from[0].x, from[1].y - from[0].y);
  const d1 = Math.hypot(to[1].x - to[0].x, to[1].y - to[0].y);
  // fingers pressed on one spot have no distance to scale by: the zoom stays
  const z = d0 === 0 ? start.z : clampZoom(start.z * (d1 / d0));
  const page = screenToPage(start, mid(from[0], from[1]));
  const at = mid(to[0], to[1]);
  return { x: page.x - at.x / z, y: page.y - at.y / z, z };
}

/**
 * Whether a finger that went down at `from` and is now at `to` (canvas px) has moved: a long press
 * and a tap allow drift up to TOUCH.slopPx.
 *
 * @public
 */
export const moved = (from: Vec2, to: Vec2): boolean => Math.hypot(to.x - from.x, to.y - from.y) > TOUCH.slopPx;

/**
 * The event the canvas dispatches (bubbling) when a context menu is asked for at a point: a finger
 * held still. Its `detail` holds `screen` and `page`, the canvas and page points.
 *
 * @public
 */
export const CONTEXT_MENU_EVENT = 'fx-contextmenu';
