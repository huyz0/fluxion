import { type Box, boxCorners, transformBox } from './box.js';
import { apply, type Mat2d, multiply, rotation, scaling, translate } from './mat2d.js';
import type { Vec2 } from './vec2.js';

/**
 * Placement of an element on screen: its unrotated box, rotation and mirroring.
 *
 * @public
 */
export type ElementTransform = {
  /** Left edge of the unrotated box. */
  readonly x: number;
  /** Top edge of the unrotated box. */
  readonly y: number;
  /** Width of the box. */
  readonly w: number;
  /** Height of the box. */
  readonly h: number;
  /** Rotation in degrees, clockwise on screen, about the box centre. */
  readonly rot: number;
  /** Mirror horizontally about the box centre. */
  readonly flipX?: boolean;
  /** Mirror vertically about the box centre. */
  readonly flipY?: boolean;
};

/**
 * Matrix mapping the element's local coordinates (`0..w`, `0..h`) to screen coordinates:
 * flips then rotation about the centre `(w/2, h/2)`, then translation to `(x, y)`.
 *
 * @public
 */
export function elementMatrix(t: ElementTransform): Mat2d {
  const cx = t.w / 2;
  const cy = t.h / 2;
  const flip = scaling(t.flipX === true ? -1 : 1, t.flipY === true ? -1 : 1);
  const aboutCentre = multiply(rotation((t.rot * Math.PI) / 180), flip);
  return multiply(translate(t.x + cx, t.y + cy), multiply(aboutCentre, translate(-cx, -cy)));
}

/**
 * Screen positions of the element's local corners, in local order
 * `(0,0)`, `(w,0)`, `(w,h)`, `(0,h)`.
 *
 * @public
 */
export function elementCorners(t: ElementTransform): readonly Vec2[] {
  const m = elementMatrix(t);
  return boxCorners({ x: 0, y: 0, w: t.w, h: t.h }).map((p) => apply(m, p));
}

/**
 * Axis-aligned screen bounds of the rotated, flipped element.
 *
 * @public
 */
export function elementBounds(t: ElementTransform): Box {
  return transformBox(elementMatrix(t), { x: 0, y: 0, w: t.w, h: t.h });
}
