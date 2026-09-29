// basic:hexagon (FR-SHP-002, FR-SHP-003): flat top and bottom, the top corners `inset` of the width in
// from the sides (0.25 in a box of 1 : 0.866 is regular).
import type { ShapeDef } from '@fluxion/sdk';

/**
 * The hexagon.
 *
 * @public
 */
export const hexagon: ShapeDef = {
  id: 'basic:hexagon',
  params: { inset: { type: 'number', min: 0, max: 0.5, default: 0.25 } },
  outline: { path: 'M {w * inset} 0 L {w - w * inset} 0 L {w} {h/2} L {w - w * inset} {h} L {w * inset} {h} L 0 {h/2} Z' },
  handles: [{ param: 'inset', x: 'w * inset', y: '0' }],
  defaultSize: { w: 140, h: 120 },
  keywords: ['hexagon', 'preparation'],
  category: 'basic',
  license: 'MIT',
};
