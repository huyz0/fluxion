// basic:octagon (FR-SHP-002, FR-SHP-003): the box with its corners cut by `cut` of the shorter side
// (0.29 of a square is regular).
import type { ShapeDef } from '@fluxion/sdk';

const q = 'cut * min(w, h)';

/**
 * The octagon.
 *
 * @public
 */
export const octagon: ShapeDef = {
  id: 'basic:octagon',
  params: { cut: { type: 'number', min: 0, max: 0.5, default: 0.29 } },
  outline: { path: `M {${q}} 0 L {w - ${q}} 0 L {w} {${q}} L {w} {h - ${q}} L {w - ${q}} {h} L {${q}} {h} L 0 {h - ${q}} L 0 {${q}} Z` },
  handles: [{ param: 'cut', x: q, y: '0' }],
  defaultSize: { w: 120, h: 120 },
  keywords: ['octagon', 'stop'],
  category: 'basic',
  license: 'MIT',
};
