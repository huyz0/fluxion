// Public entry of @fluxion/player; the package comment is the dts banner in tsdown.config.ts.

export { PlayerRoot, type PlayerRootProps } from './player-root.js';
export { renderRegistriesFor } from './registries.js';
export { type Box, useElementBox } from './use-box.js';

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';
