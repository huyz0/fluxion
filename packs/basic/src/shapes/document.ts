// basic:document (FR-SHP-002, FR-SHP-003): a page whose bottom edge waves `wave` of the height (a
// flowchart document).
import type { ShapeDef } from '@fluxion/sdk';

const a = 'h * wave';

/**
 * The document.
 *
 * @public
 */
export const document: ShapeDef = {
  id: 'basic:document',
  params: { wave: { type: 'number', min: 0, max: 0.25, default: 0.1 } },
  outline: { path: `M 0 0 H {w} V {h - ${a}} C {w * 0.7} {h - 2 * ${a}} {w * 0.3} {h} 0 {h - ${a}} Z` },
  handles: [{ param: 'wave', x: 'w', y: `h - ${a}` }],
  defaultSize: { w: 160, h: 100 },
  keywords: ['document', 'page', 'report'],
  category: 'basic',
  license: 'MIT',
};
