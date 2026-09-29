// basic:ellipse (FR-SHP-002): the ellipse inscribed in the box, drawn as two half arcs.
import type { ShapeDef } from '@fluxion/sdk';

/**
 * The ellipse.
 *
 * @public
 */
export const ellipse: ShapeDef = {
  id: 'basic:ellipse',
  outline: { path: 'M 0 {h/2} A {w/2} {h/2} 0 1 1 {w} {h/2} A {w/2} {h/2} 0 1 1 0 {h/2} Z' },
  defaultSize: { w: 140, h: 100 },
  keywords: ['ellipse', 'circle', 'oval'],
  category: 'basic',
  license: 'MIT',
};
