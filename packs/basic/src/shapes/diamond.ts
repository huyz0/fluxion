// basic:diamond (FR-SHP-002): the rhombus through the midpoints of the sides of the box (a flowchart
// decision).
import type { ShapeDef } from '@fluxion/sdk';

/**
 * The diamond.
 *
 * @public
 */
export const diamond: ShapeDef = {
  id: 'basic:diamond',
  outline: { path: 'M {w/2} 0 L {w} {h/2} L {w/2} {h} L 0 {h/2} Z' },
  defaultSize: { w: 140, h: 100 },
  keywords: ['diamond', 'rhombus', 'decision'],
  category: 'basic',
  license: 'MIT',
};
