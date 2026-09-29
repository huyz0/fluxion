// basic:parallelogram (FR-SHP-002, FR-SHP-003): the box slanted by `skew` of its width (a flowchart
// input or output).
import type { ShapeDef } from '@fluxion/sdk';

/**
 * The parallelogram.
 *
 * @public
 */
export const parallelogram: ShapeDef = {
  id: 'basic:parallelogram',
  params: { skew: { type: 'number', min: 0, max: 0.9, default: 0.2 } },
  outline: { path: 'M {w * skew} 0 L {w} 0 L {w - w * skew} {h} L 0 {h} Z' },
  handles: [{ param: 'skew', x: 'w * skew', y: '0' }],
  defaultSize: { w: 160, h: 90 },
  keywords: ['parallelogram', 'input', 'output'],
  category: 'basic',
  license: 'MIT',
};
