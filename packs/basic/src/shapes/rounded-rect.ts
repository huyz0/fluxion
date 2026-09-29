// basic:rounded-rect (FR-SHP-002, FR-SHP-003): a rectangle whose corners are quarter circles of radius
// `r`, never more than half the shorter side.
import type { ShapeDef } from '@fluxion/sdk';

const q = 'min(r, w/2, h/2)';

/**
 * The rounded rectangle.
 *
 * @public
 */
export const roundedRect: ShapeDef = {
  id: 'basic:rounded-rect',
  params: { r: { type: 'number', min: 0, max: 1000, default: 12 } },
  outline: {
    path: `M {${q}} 0 H {w - ${q}} A {${q}} {${q}} 0 0 1 {w} {${q}} V {h - ${q}} A {${q}} {${q}} 0 0 1 {w - ${q}} {h} H {${q}} A {${q}} {${q}} 0 0 1 0 {h - ${q}} V {${q}} A {${q}} {${q}} 0 0 1 {${q}} 0 Z`,
  },
  handles: [{ param: 'r', x: q, y: '0' }],
  defaultSize: { w: 160, h: 100 },
  keywords: ['rounded', 'rectangle', 'card', 'button'],
  category: 'basic',
  license: 'MIT',
};
