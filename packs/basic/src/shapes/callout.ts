// basic:callout (FR-SHP-002, FR-SHP-003): a speech bubble; the body takes the top `1 - tail` of the
// height, and a tail `width` of the box wide points down to `tip` of the width.
import type { ShapeDef } from '@fluxion/sdk';

const body = 'h - h * tail';
const start = 'clamp(w * tip - w * width / 2, 0, w - w * width)';

/**
 * The callout.
 *
 * @public
 */
export const callout: ShapeDef = {
  id: 'basic:callout',
  params: {
    tail: { type: 'number', min: 0.05, max: 0.6, default: 0.25 },
    tip: { type: 'number', min: 0, max: 1, default: 0.25 },
    width: { type: 'number', min: 0.02, max: 0.9, default: 0.15 },
  },
  outline: { path: `M 0 0 H {w} V {${body}} H {${start} + w * width} L {w * tip} {h} L {${start}} {${body}} H 0 Z` },
  handles: [{ param: 'tip', x: 'w * tip', y: 'h' }],
  textRegions: [{ name: 'body', x: 0.05, y: 0.05, w: 0.9, h: 0.6 }],
  defaultSize: { w: 180, h: 110 },
  keywords: ['callout', 'speech', 'bubble', 'comment'],
  category: 'basic',
  license: 'MIT',
};
