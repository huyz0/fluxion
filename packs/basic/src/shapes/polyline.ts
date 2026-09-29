// basic:polyline (FR-SHP-002): an open run of straight segments through the element's own vertices
// (fractions of its box, param `vertices`).
import type { ShapeDef } from '@fluxion/sdk';

/**
 * The polyline.
 *
 * @public
 */
export const polyline: ShapeDef = {
  id: 'basic:polyline',
  params: {
    vertices: {
      type: 'points',
      min: 2,
      max: 10_000,
      default: [
        [0, 1],
        [0.35, 0],
        [0.65, 1],
        [1, 0],
      ],
    },
  },
  outline: { points: 'vertices' },
  defaultSize: { w: 160, h: 80 },
  keywords: ['polyline', 'zigzag', 'path'],
  category: 'basic',
  license: 'MIT',
};
