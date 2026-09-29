// basic:cylinder (FR-SHP-002, FR-SHP-003): a drum whose top and bottom are half ellipses `depth` of the
// height tall; the front rim of the top is a decoration (a database).
import type { ShapeDef } from '@fluxion/sdk';

const e = 'h * depth';

/**
 * The cylinder.
 *
 * @public
 */
export const cylinder: ShapeDef = {
  id: 'basic:cylinder',
  params: { depth: { type: 'number', min: 0.02, max: 0.5, default: 0.15 } },
  outline: { path: `M 0 {${e}} V {h - ${e}} A {w/2} {${e}} 0 0 0 {w} {h - ${e}} V {${e}} A {w/2} {${e}} 0 0 0 0 {${e}} Z` },
  decorations: [{ path: `M 0 {${e}} A {w/2} {${e}} 0 0 0 {w} {${e}}` }],
  handles: [{ param: 'depth', x: 'w/2', y: `2 * ${e}` }],
  textRegions: [{ name: 'body', x: 0.05, y: 0.35, w: 0.9, h: 0.5 }],
  defaultSize: { w: 120, h: 140 },
  keywords: ['cylinder', 'database', 'storage'],
  category: 'basic',
  license: 'MIT',
};
