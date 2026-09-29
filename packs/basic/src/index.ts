// Public entry of @fluxion/pack-basic; the package comment is the dts banner in tsdown.config.ts.
import { definePack, type Pack } from '@fluxion/sdk';
import { blockArrow } from './shapes/block-arrow.js';
import { diamond } from './shapes/diamond.js';
import { ellipse } from './shapes/ellipse.js';
import { hexagon } from './shapes/hexagon.js';
import { octagon } from './shapes/octagon.js';
import { parallelogram } from './shapes/parallelogram.js';
import { rect } from './shapes/rect.js';
import { roundedRect } from './shapes/rounded-rect.js';
import { star } from './shapes/star.js';
import { trapezoid } from './shapes/trapezoid.js';
import { triangle } from './shapes/triangle.js';

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';

/**
 * The basic shapes (FR-SHP-002), namespace `basic`. Hosts register it into their core registries
 * (ADR-0017): `basicPack.register(registries)`.
 *
 * @public
 */
export const basicPack: Pack = definePack({
  id: 'basic',
  shapes: [rect, roundedRect, ellipse, triangle, diamond, parallelogram, trapezoid, hexagon, octagon, star, blockArrow],
});

export { blockArrow, diamond, ellipse, hexagon, octagon, parallelogram, rect, roundedRect, star, trapezoid, triangle };
