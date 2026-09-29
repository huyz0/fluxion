// basic:freehand (FR-SHP-002): an open, smooth stroke through the element's own vertices (param
// `stroke`, fractions of its box), as drawn with a pen.
import type { ShapeDef } from '@fluxion/sdk';

/**
 * The freehand path.
 *
 * @public
 */
export const freehand: ShapeDef = {
  id: 'basic:freehand',
  params: {
    stroke: {
      type: 'points',
      min: 2,
      max: 10_000,
      default: [
        [0, 0.5],
        [0.25, 0.2],
        [0.5, 0.5],
        [0.75, 0.8],
        [1, 0.5],
      ],
    },
  },
  outline: { points: 'stroke', smooth: true },
  defaultSize: { w: 160, h: 80 },
  defaultStyle: { stroke: { cap: 'round', join: 'round' } },
  keywords: ['freehand', 'pen', 'scribble', 'drawing'],
  category: 'basic',
  license: 'MIT',
};
