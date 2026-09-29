// basic:line (FR-SHP-002): an open, horizontal stroke through the middle of the box; the box's height
// is only where it can be picked up. For a line between two elements, use a connector.
import type { ShapeDef } from '@fluxion/sdk';

/**
 * The line.
 *
 * @public
 */
export const line: ShapeDef = {
  id: 'basic:line',
  outline: { path: 'M 0 {h/2} L {w} {h/2}' },
  defaultSize: { w: 160, h: 16 },
  keywords: ['line', 'rule', 'divider', 'separator'],
  category: 'basic',
  license: 'MIT',
};
