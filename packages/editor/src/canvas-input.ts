// What the canvas's wheel and keyboard input do to the camera (FR-EDT-002): pure, so the DOM glue in
// use-canvas-input.ts stays thin. A plain wheel pans, ctrl/meta + wheel (and a trackpad pinch, which
// browsers send as one) zooms about the pointer; shortcuts zoom about the canvas centre, fit the
// screen and go to 100 %.
import type { Box, Vec2 } from '@fluxion/geometry';
import { type Camera, fitBox, panBy, zoomBy, zoomTo100 } from './camera.js';

/**
 * A wheel event as the canvas sees it.
 *
 * @public
 */
export type WheelInput = {
  /** Horizontal delta, in `mode` units. */
  readonly dx: number;
  /** Vertical delta, in `mode` units. */
  readonly dy: number;
  /** `WheelEvent.deltaMode`: 0 px, 1 lines, 2 pages. */
  readonly mode: number;
  /** Ctrl or meta held (a trackpad pinch comes as ctrl + wheel). */
  readonly zoom: boolean;
  /** Shift held: a vertical wheel pans sideways. */
  readonly shift: boolean;
  /** The pointer, in canvas px. */
  readonly at: Vec2;
};

/**
 * Px per wheel line (`deltaMode` 1).
 *
 * @public
 */
export const WHEEL_LINE_PX = 16;

/**
 * The wheel px that halve or double the zoom.
 *
 * @public
 */
export const WHEEL_ZOOM_PX = 100;

/**
 * The factor a zoom shortcut multiplies the zoom by.
 *
 * @public
 */
export const ZOOM_STEP = 2;

/**
 * `camera` after the wheel input `w` on a canvas of `viewport` size.
 *
 * @public
 */
export function wheelCamera(camera: Camera, w: WheelInput, viewport: { readonly w: number; readonly h: number }): Camera {
  const unit = w.mode === 1 ? WHEEL_LINE_PX : w.mode === 2 ? viewport.h : 1;
  const dx = w.dx * unit;
  const dy = w.dy * unit;
  if (w.zoom) return zoomBy(camera, w.at, 2 ** (-dy / WHEEL_ZOOM_PX));
  // a shifted vertical wheel scrolls sideways (browsers other than Safari leave that to the page)
  const d = w.shift && dx === 0 ? { x: dy, y: 0 } : { x: dx, y: dy };
  return panBy(camera, { x: -d.x, y: -d.y });
}

/**
 * A key press as the canvas sees it.
 *
 * @public
 */
export type KeyInput = {
  /** `KeyboardEvent.key`. */
  readonly key: string;
  /** `KeyboardEvent.code` (layout independent: shift + 1 is `Digit1` whatever it types). */
  readonly code: string;
  /** Ctrl or meta held. */
  readonly mod: boolean;
  /** Shift held. */
  readonly shift: boolean;
  /** Alt held. */
  readonly alt: boolean;
};

/**
 * `camera` after the shortcut `k`, or undefined when `k` is no camera shortcut: ctrl/meta + `=` or
 * `+` zooms in, ctrl/meta + `-` zooms out (about the centre), ctrl/meta + `0` and shift + `0` go to
 * 100 %, shift + `1` fits `area` (the screen).
 *
 * @public
 */
export function shortcutCamera(camera: Camera, k: KeyInput, viewport: { readonly w: number; readonly h: number }, area: Box): Camera | undefined {
  if (k.alt) return undefined;
  const centre = { x: viewport.w / 2, y: viewport.h / 2 };
  if (k.mod) {
    if (k.key === '=' || k.key === '+') return zoomBy(camera, centre, ZOOM_STEP);
    if (k.key === '-') return zoomBy(camera, centre, 1 / ZOOM_STEP);
    return k.code === 'Digit0' ? zoomTo100(camera, viewport) : undefined;
  }
  if (!k.shift) return undefined;
  if (k.code === 'Digit0') return zoomTo100(camera, viewport);
  return k.code === 'Digit1' ? fitBox(area, viewport) : undefined;
}
