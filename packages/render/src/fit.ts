// The views of a screen (04 §2.2): `fit` scales it uniformly to fit a box, centred (present mode);
// `camera` draws page point p at (p - (x, y)) * z (the editor canvas, 04 §3.3). Pure, so the
// arithmetic is tested in Node and the browser test checks the DOM.
import { type Rect, type ScreenRecord, screenKind, screenSize } from '@fluxion/schema';

/**
 * The logical area a screen shows: its size at the origin, or an infinite screen's viewport.
 *
 * @public
 */
export function screenArea(screen: Pick<ScreenRecord, 'kind' | 'size' | 'viewport'>): Rect {
  if (screenKind(screen) === 'infinite' && screen.viewport) return screen.viewport;
  const { w, h } = screenSize(screen);
  return { x: 0, y: 0, w, h };
}

/**
 * The transform that fits `area` into a `box` (uniform scale, centred): CSS `translate(x, y) scale(s)`
 * applied with origin 0 0 to an element of the area's size.
 *
 * @public
 */
export type FitTransform = {
  /** Scale factor. */
  readonly scale: number;
  /** Horizontal offset in box pixels. */
  readonly x: number;
  /** Vertical offset in box pixels. */
  readonly y: number;
};

/**
 * Fit `area` into `box`: the largest uniform scale at which it fits, centred.
 *
 * @public
 */
export function fitTransform(area: { readonly w: number; readonly h: number }, box: { readonly w: number; readonly h: number }): FitTransform {
  const scale = area.w > 0 && area.h > 0 ? Math.min(box.w / area.w, box.h / area.h) : 1;
  return { scale, x: (box.w - area.w * scale) / 2, y: (box.h - area.h * scale) / 2 };
}

/**
 * The transform that draws `area` through the camera `{x, y, z}`: page point p lands at
 * (p - (x, y)) * z in the box.
 *
 * @public
 */
export function cameraTransform(area: Rect, camera: { readonly x: number; readonly y: number; readonly z: number }): FitTransform {
  return { scale: camera.z, x: (area.x - camera.x) * camera.z, y: (area.y - camera.y) * camera.z };
}
