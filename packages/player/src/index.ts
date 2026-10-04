// Public entry of @fluxion/player; the package comment is the dts banner in tsdown.config.ts.

export { LASER_FADE, type LaserPoint, type TrailDot, trailKeys } from './laser-keys.js';
export { LaserTrail, type LaserTrailProps } from './laser-trail.js';
export { PlayerDeck, type PlayerDeckProps } from './player-deck.js';
export { PlayerRoot, type PlayerRootProps } from './player-root.js';
export { renderRegistriesFor } from './registries.js';
export { type Box, useElementBox } from './use-box.js';

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';
