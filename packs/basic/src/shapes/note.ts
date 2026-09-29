// basic:note (FR-SHP-002, FR-SHP-003): a sheet with its top-right corner folded by `fold` of the shorter
// side; the fold's crease is a decoration.
import type { ShapeDef } from '@fluxion/sdk';

const f = 'fold * min(w, h)';

/**
 * The note.
 *
 * @public
 */
export const note: ShapeDef = {
  id: 'basic:note',
  params: { fold: { type: 'number', min: 0, max: 0.5, default: 0.2 } },
  outline: { path: `M 0 0 H {w - ${f}} L {w} {${f}} V {h} H 0 Z` },
  decorations: [{ path: `M {w - ${f}} 0 V {${f}} H {w}` }],
  handles: [{ param: 'fold', x: `w - ${f}`, y: '0' }],
  defaultSize: { w: 140, h: 140 },
  keywords: ['note', 'sticky', 'comment'],
  category: 'basic',
  license: 'MIT',
};
