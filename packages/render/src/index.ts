// Public entry of @fluxion/render; the package comment is the dts banner in tsdown.config.ts.

export { CONTENT_CSS } from './content-css.js';
export { type FitTransform, fitTransform, screenArea } from './fit.js';
export { type ModePolicy, modePolicy, type RenderMode } from './mode-policy.js';
export { ScreenView, type ScreenViewProps, type ScreenViewSpec } from './screen-view.js';
export { useValue } from './use-value.js';

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';
