// The laser (FR-EDT-003, FR-PRS-008): a presenter's pointer, registered for present mode only. It
// follows the pointer with a short trail (the session's `laser`, newest last) that the overlay draws
// fading, and never writes to the document. The present-mode switch (M6.20) dispatches it.
import type { Vec2 } from '@fluxion/geometry';
import type { Tool, ToolCtx } from './tools.js';

/**
 * How many recent pointer positions the laser's trail keeps.
 *
 * @public
 */
export const LASER_TRAIL = 12;

/** The trail with `p` added, its oldest dropped past LASER_TRAIL. */
const followed = (ctx: ToolCtx, p: Vec2): readonly Vec2[] => [...ctx.session.laser.get(), p].slice(-LASER_TRAIL);

/**
 * The laser tool (L), for present mode: moves draw its trail; nothing is written.
 *
 * @public
 */
export function laserTool(): Tool {
  return {
    id: 'laser',
    title: 'Laser',
    shortcut: 'l',
    modes: ['present'],
    initial: 'idle',
    states: {
      idle: {
        id: 'idle',
        onPointerMove: (ctx, e) => {
          ctx.session.laser.set(followed(ctx, e.page));
          return undefined;
        },
        // a press is the presenter's, and neither selects nor moves anything
        onPointerDown: () => undefined,
        onCancel: (ctx) => {
          ctx.session.laser.set([]);
          return undefined;
        },
        onExit: (ctx) => ctx.session.laser.set([]),
      },
    },
  };
}
