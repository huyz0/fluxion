// Public entry of @fluxion/render; the package comment is the dts banner in tsdown.config.ts.

export { paintCss } from './background.js';
export { CONTENT_CSS } from './content-css.js';
export { DocumentView, type DocumentViewProps } from './document-view.js';
export { ElementList, type ElementListProps } from './elements.js';
export { type FitTransform, fitTransform, screenArea } from './fit.js';
export { type ModePolicy, modePolicy, type RenderMode } from './mode-policy.js';
export { createRenderRegistries, type ElementView, type ElementViewProps, type RenderRegistries } from './registries.js';
export { elementsInOrder, screensInOrder } from './screen-order.js';
export { ScreenView, type ScreenViewProps, type ScreenViewSpec } from './screen-view.js';
export { useValue } from './use-value.js';

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';
