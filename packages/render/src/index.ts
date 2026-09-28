// Public entry of @fluxion/render; the package comment is the dts banner in tsdown.config.ts.

export { paintCss } from './background.js';
export { BASIC_RECT } from './basic-rect.js';
export { builtinRegistries, registerBuiltinViews } from './builtins.js';
export { type ConnectorEnds, connectorEnds } from './connector-ends.js';
export { ConnectorView } from './connector-view.js';
export { CONTENT_CSS } from './content-css.js';
export { DocumentView, type DocumentViewProps } from './document-view.js';
export { ElementList, type ElementListProps, PlaceholderView } from './elements.js';
export { type FitTransform, fitTransform, screenArea } from './fit.js';
export { plainParagraphs } from './label.js';
export { type ModePolicy, modePolicy, type RenderMode } from './mode-policy.js';
export { pathData } from './path-data.js';
export { createRenderRegistries, type ElementView, type ElementViewProps, type RenderRegistries, type ShapeOutline } from './registries.js';
export { elementsInOrder, screensInOrder } from './screen-order.js';
export { ScreenView, type ScreenViewProps, type ScreenViewSpec } from './screen-view.js';
export { ShapeView } from './shape-view.js';
export { useValue } from './use-value.js';

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';
