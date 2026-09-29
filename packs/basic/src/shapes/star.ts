// basic:star (FR-SHP-002, FR-SHP-003): `points` tips on the ellipse of the box, alternating with inner
// vertices at `inner` of the radius; the first tip points up.
import type { ShapeDef } from '@fluxion/sdk';

const radius = '(i % 2 ? inner : 1)';

/**
 * The star.
 *
 * @public
 */
export const star: ShapeDef = {
  id: 'basic:star',
  params: {
    points: { type: 'int', min: 3, max: 64, default: 5 },
    inner: { type: 'number', min: 0.1, max: 0.95, default: 0.5 },
  },
  outline: {
    polygon: {
      n: '2 * points',
      x: `w/2 + ${radius} * w/2 * sin(2 * pi * i / n)`,
      y: `h/2 - ${radius} * h/2 * cos(2 * pi * i / n)`,
    },
  },
  handles: [{ param: 'inner', x: 'w/2 + inner * w/2 * sin(pi / points)', y: 'h/2 - inner * h/2 * cos(pi / points)' }],
  defaultSize: { w: 120, h: 120 },
  keywords: ['star', 'rating', 'favourite'],
  category: 'basic',
  license: 'MIT',
};
