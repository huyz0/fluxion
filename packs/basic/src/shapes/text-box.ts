// basic:text-box (FR-SHP-002): a rectangle with no fill and no stroke, for text placed freely.
import type { ShapeDef } from '@fluxion/sdk';

/**
 * The text box.
 *
 * @public
 */
export const textBox: ShapeDef = {
  id: 'basic:text-box',
  outline: { path: 'M 0 0 L {w} 0 L {w} {h} L 0 {h} Z' },
  textRegions: [{ name: 'body', x: 0, y: 0, w: 1, h: 1 }],
  defaultSize: { w: 200, h: 60 },
  defaultStyle: { fill: 'transparent', stroke: { width: 0 } },
  keywords: ['text', 'label', 'title'],
  category: 'basic',
  license: 'MIT',
};
