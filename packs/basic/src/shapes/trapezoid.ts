// basic:trapezoid (FR-SHP-002, FR-SHP-003): the top edge inset by `inset` of the width on each side.
import type { ShapeDef } from '@fluxion/sdk';

/**
 * The trapezoid.
 *
 * @public
 */
export const trapezoid: ShapeDef = {
  id: 'basic:trapezoid',
  params: { inset: { type: 'number', min: 0, max: 0.49, default: 0.2 } },
  outline: { path: 'M {w * inset} 0 L {w - w * inset} 0 L {w} {h} L 0 {h} Z' },
  handles: [{ param: 'inset', x: 'w * inset', y: '0' }],
  defaultSize: { w: 160, h: 90 },
  keywords: ['trapezoid', 'manual operation'],
  category: 'basic',
  license: 'MIT',
};
