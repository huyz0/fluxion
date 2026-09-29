// basic:rect (FR-SHP-002): the box itself, clockwise from the top-left corner.
import type { ShapeDef } from '@fluxion/sdk';

/**
 * The rectangle.
 *
 * @public
 */
export const rect: ShapeDef = {
  id: 'basic:rect',
  outline: { path: 'M 0 0 L {w} 0 L {w} {h} L 0 {h} Z' },
  defaultSize: { w: 160, h: 100 },
  keywords: ['rectangle', 'box', 'square'],
  category: 'basic',
  license: 'MIT',
};
