// basic:block-arrow (FR-SHP-002, FR-SHP-003): a filled arrow pointing right; the head takes `head` of the
// width, the shaft `shaft` of the height.
import type { ShapeDef } from '@fluxion/sdk';

const neck = 'w - w * head';
const edge = 'h * (1 - shaft) / 2';

/**
 * The block arrow.
 *
 * @public
 */
export const blockArrow: ShapeDef = {
  id: 'basic:block-arrow',
  params: {
    head: { type: 'number', min: 0.05, max: 0.95, default: 0.35 },
    shaft: { type: 'number', min: 0.05, max: 0.95, default: 0.5 },
  },
  outline: {
    path: `M 0 {${edge}} L {${neck}} {${edge}} L {${neck}} 0 L {w} {h/2} L {${neck}} {h} L {${neck}} {h - ${edge}} L 0 {h - ${edge}} Z`,
  },
  handles: [
    { param: 'head', x: neck, y: '0' },
    { param: 'shaft', x: '0', y: edge },
  ],
  defaultSize: { w: 160, h: 80 },
  keywords: ['arrow', 'next', 'direction'],
  category: 'basic',
  license: 'MIT',
};
