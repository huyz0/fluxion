// Camera math (FR-EDT-002, 04 §3.3): the camera {x, y, z} maps page coordinates (the screen's own
// units) to canvas pixels: screen = (page - (x, y)) * z. Zoom is clamped to 5 %-3200 %; zooming about
// a point keeps the page point under it still. Pure: the canvas (M6.8) applies it as one transform.
import type { Box, Vec2 } from '@fluxion/geometry';

/**
 * The camera: the page point at the canvas's top-left (`x`, `y`) and the zoom `z` (1 = 100 %).
 *
 * @public
 */
export type Camera = {
  /** Page x at the viewport's left edge. */
  readonly x: number;
  /** Page y at the viewport's top edge. */
  readonly y: number;
  /** Zoom: canvas px per page unit. */
  readonly z: number;
};

/**
 * The zoom limits: 5 % and 3200 % (FR-EDT-002).
 *
 * @public
 */
export const ZOOM_LIMITS: {
  /** The least zoom, 0.05 (5 %). */
  readonly min: number;
  /** The greatest zoom, 32 (3200 %). */
  readonly max: number;
} = { min: 0.05, max: 32 };

/**
 * The space kept around a box zoomed to fit, in canvas px on each side.
 *
 * @public
 */
export const FIT_PADDING = 32;

/**
 * `z` within the zoom limits; an infinite zoom clamps to its limit, NaN (no direction) is 100 %.
 *
 * @public
 */
export function clampZoom(z: number): number {
  if (Number.isNaN(z)) return 1;
  return Math.min(Math.max(z, ZOOM_LIMITS.min), ZOOM_LIMITS.max);
}

/**
 * The page point under the canvas point `p`.
 *
 * @public
 */
export function screenToPage(camera: Camera, p: Vec2): Vec2 {
  return { x: p.x / camera.z + camera.x, y: p.y / camera.z + camera.y };
}

/**
 * The canvas point where the page point `p` is drawn.
 *
 * @public
 */
export function pageToScreen(camera: Camera, p: Vec2): Vec2 {
  return { x: (p.x - camera.x) * camera.z, y: (p.y - camera.y) * camera.z };
}

/**
 * `camera` zoomed to `z` (clamped) about the canvas point `at`: the page point under `at` stays there.
 *
 * @public
 */
export function zoomAt(camera: Camera, at: Vec2, z: number): Camera {
  const next = clampZoom(z);
  const page = screenToPage(camera, at);
  return { x: page.x - at.x / next, y: page.y - at.y / next, z: next };
}

/**
 * `camera` zoomed by `factor` about the canvas point `at` (2 doubles the zoom).
 *
 * @public
 */
export function zoomBy(camera: Camera, at: Vec2, factor: number): Camera {
  return zoomAt(camera, at, camera.z * factor);
}

/**
 * `camera` moved so the page follows a canvas drag of `d` px.
 *
 * @public
 */
export function panBy(camera: Camera, d: Vec2): Camera {
  return { x: camera.x - d.x / camera.z, y: camera.y - d.y / camera.z, z: camera.z };
}

/**
 * The camera that shows the page box `box` whole and centred in a `viewport`-sized canvas, with
 * `padding` px around it; the zoom is clamped. A point (no width, no height) is centred at 100 %.
 *
 * @public
 */
export function fitBox(box: Box, viewport: { readonly w: number; readonly h: number }, padding: number = FIT_PADDING): Camera {
  const room = { w: Math.max(viewport.w - 2 * padding, 1), h: Math.max(viewport.h - 2 * padding, 1) };
  // a side of 0 divides to Infinity, so a line fits along its length alone; a point has no size to fit
  const fit = Math.min(room.w / box.w, room.h / box.h);
  const z = fit === Number.POSITIVE_INFINITY ? 1 : clampZoom(fit);
  return { x: box.x + box.w / 2 - viewport.w / (2 * z), y: box.y + box.h / 2 - viewport.h / (2 * z), z };
}

/**
 * `camera` at 100 %, about the centre of a `viewport`-sized canvas.
 *
 * @public
 */
export function zoomTo100(camera: Camera, viewport: { readonly w: number; readonly h: number }): Camera {
  return zoomAt(camera, { x: viewport.w / 2, y: viewport.h / 2 }, 1);
}
