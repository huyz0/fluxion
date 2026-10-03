// Public entry of @fluxion/render; the package comment is the dts banner in tsdown.config.ts.

export type { AssetUrls } from './assets.js';
export { paintCss } from './background.js';
export { builtinRegistries, registerBuiltinViews } from './builtins.js';
export { ConnectorView } from './connector-view.js';
export { FrameView, GroupView } from './container-views.js';
export { CONTENT_CSS } from './content-css.js';
export { DocumentView, type DocumentViewProps } from './document-view.js';
export { ElementList, type ElementListProps, PlaceholderView } from './elements.js';
export { cameraTransform, type FitTransform, fitTransform, screenArea } from './fit.js';
export { normalizeSvg } from './golden.js';
export { ImageView } from './image-view.js';
export { plainParagraphs } from './label.js';
export { BUILTIN_MARKERS, registerBuiltinMarkers } from './markers.js';
export { type ModePolicy, modePolicy, type RenderMode } from './mode-policy.js';
export { pathData } from './path-data.js';
export { createRenderRegistries, type ElementView, type ElementViewProps, type RenderRegistries } from './registries.js';
export { type BlockPlan, planBlock } from './rich-blocks.js';
export { styledBlocks } from './rich-layout.js';
export { type MarkPlan, planMarks } from './rich-marks.js';
export { RichText } from './rich-text.js';
export { elementsInOrder, screensInOrder } from './screen-order.js';
export { useScreenTheme } from './screen-theme.js';
export { ScreenView, type ScreenViewProps, type ScreenViewSpec, type ViewBox } from './screen-view.js';
export { grownHeight, labelBox, ShapeView } from './shape-view.js';
export { type RenderedHtml, type RenderHtmlOptions, renderDocumentToHtml } from './ssr.js';
export { type CanvasTextMeasurer, createCanvasMeasurer } from './text-measurer.js';
export { TextView } from './text-view.js';
export { useValue } from './use-value.js';

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';
