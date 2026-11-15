// Present in place, the pure parts (FR-EDT-009, FR-PRS-004): the read-only guard the present tools
// write through, and the camera of the fitted screen that maps the pointer to page points.
import type { Box } from '@fluxion/geometry';
import { fitTransform } from '@fluxion/render';
import { t } from '@lingui/core/macro';
import type { Camera } from './camera.js';
import type { Execute } from './pointer.js';
import type { Session } from './session.js';

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

/**
 * What {@link presentFrom} takes of an editor command's context.
 *
 * @public
 */
export type PresentCtx = {
  /** The tools, and through them the session whose mode it reads. */
  readonly tools: { readonly ctx: { readonly session: Session } };
  /** Switch between editing and presenting. */
  switchMode?(from?: 'start' | 'current'): void;
  /** Show a short notice. */
  notify?(message: string): void;
};

/**
 * Switch modes, entering `from` the first visible screen or the shown one; with nothing to present (the shown screen a master and
 * no visible screen besides) it stays editing and says so. False without a mode switch.
 *
 * @public
 */
export function presentFrom(ctx: PresentCtx, from: 'start' | 'current'): boolean {
  if (ctx.switchMode === undefined) return false;
  const editing = ctx.tools.ctx.session.mode.get() === 'edit';
  ctx.switchMode(from);
  if (editing && ctx.tools.ctx.session.mode.get() === 'edit') ctx.notify?.(t`Nothing to present: every screen is a master or hidden.`);
  return true;
}
