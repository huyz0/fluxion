// Public entry of @fluxion/player; the package comment is the dts banner in tsdown.config.ts.

// the recorded metrics of a font the page has loaded (ADR-0148): a host that loads a document's own fonts registers them so text is measured as the editor did
export { registerFontMetrics } from '@fluxion/render';
export { realtimeClock } from './clock.js';
export { buildsOfScreen, hiddenAt } from './deck-builds.js';
export { type DeckAction, deckAction, NumberEntry } from './deck-input.js';
export { bindLinks, formatLink, type LinkWindow, parseLink } from './deck-links.js';
export { type FullscreenDocument, type FullscreenResult, type FullscreenTarget, toggleFullscreen } from './fullscreen.js';
export { LASER_FADE, type LaserPoint, type TrailDot, trailKeys } from './laser-keys.js';
export { LaserTrail, type LaserTrailProps } from './laser-trail.js';
export { PlayerDeck, type PlayerDeckProps } from './player-deck.js';
export { PlayerRoot, type PlayerRootProps } from './player-root.js';
export { type DeckSource, type Position, PresentationController, type Visit } from './presentation-controller.js';
export { renderRegistriesFor } from './registries.js';
export { type Box, useElementBox } from './use-box.js';

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';
