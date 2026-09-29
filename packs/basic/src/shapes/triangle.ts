// basic:triangle (FR-SHP-002, FR-SHP-003): a triangle on the bottom edge whose apex sits at `apex` of
// the width (0.5: isosceles, 0: right-angled on the left).
import type { ShapeDef } from '@fluxion/sdk';

/**
 * The triangle.
 *
 * @public
 */
export const triangle: ShapeDef = {
  id: 'basic:triangle',
  params: { apex: { type: 'number', min: 0, max: 1, default: 0.5 } },
  outline: { path: 'M {w * apex} 0 L {w} {h} L 0 {h} Z' },
  handles: [{ param: 'apex', x: 'w * apex', y: '0' }],
  defaultSize: { w: 120, h: 100 },
  keywords: ['triangle', 'warning'],
  category: 'basic',
  license: 'MIT',
};
