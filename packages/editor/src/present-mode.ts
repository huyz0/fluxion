// Present in place, the pure parts (FR-EDT-009, FR-PRS-004): the read-only guard the present tools
// write through, and the camera of the fitted screen that maps the pointer to page points.
import type { Box } from '@fluxion/geometry';
import { fitTransform } from '@fluxion/render';
import type { Camera } from './camera.js';
import type { Execute } from './pointer.js';

/**
 * The read-only guard while presenting: every command is refused (TX_READ_ONLY), nothing is written.
 *
 * @public
 */
export const readOnly: Execute = () => ({
  ok: false,
  error: { code: 'TX_READ_ONLY', message: 'presenting: the document is read-only', diagnostics: [] },
});

/**
 * The camera of a screen `area` fitted into a `box` (present mode's fit, as a camera): what maps the
 * pointer to page points while presenting.
 *
 * @public
 */
export function fitCamera(area: Box, box: { readonly w: number; readonly h: number }): Camera {
  const f = fitTransform(area, box);
  return { x: area.x - f.x / f.scale, y: area.y - f.y / f.scale, z: f.scale };
}
