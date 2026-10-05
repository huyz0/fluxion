// The player's clock: the page's own, for the presentation controller (`Clock` is a port of core, FR-PRS-002).
import type { Clock } from '@fluxion/core';

/**
 * A clock reading `performance.now()` and scheduling frames with `requestAnimationFrame`.
 *
 * @public
 */
export const realtimeClock: Clock = {
  now: () => performance.now(),
  frame: (callback) => {
    const id = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(id);
  },
};
