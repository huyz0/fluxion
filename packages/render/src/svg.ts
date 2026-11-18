// `@fluxion/render/svg` (ADR-0056 item 1, FR-EXP-004): a screen on the svg surface. The same store reads as <ScreenView> (the applied
// master, the screen's theme as core picks it, its background, the element order and the registered views), drawn as one SVG 1.1
// document by each view's `Svg` leaf, the built-in views' leaves supplied here. Its own entry, so the player and the editor's
// initial bundle never carry it (NFR-SIZE-001/002); the exporters render it with react-dom/server.
import type { Store } from '@fluxion/core';
import type { RecordId, ScreenRecord } from '@fluxion/schema';
import type { Theme } from '@fluxion/theme';
import { type ComponentType, createElement, type ReactNode, useContext, useMemo } from 'react';
import { builtinRegistries } from './builtins.js';
import { ConnectorView } from './connector-view.js';
import { FrameView, GroupView } from './container-views.js';
import { screenArea } from './fit.js';
import { ImageView } from './image-view.js';
import { useMasterLayers } from './master-view.js';
import { modePolicy, type RenderMode } from './mode-policy.js';
import type { ElementViewProps, RenderRegistries } from './registries.js';
import { useScreenTheme } from './screen-theme.js';
import { screenBackground } from './screen-view.js';
import { ShapeView } from './shape-view.js';
import { FrameSvg, ImageSvg } from './svg-boxes.js';
import { ConnectorSvg } from './svg-connector.js';
import { ScreenSvg, SvgSurface } from './svg-surface.js';
import { GroupSvg, ShapeSvg, TextSvg } from './svg-views.js';
import { TextView } from './text-view.js';
import { useValue } from './use-value.js';

/**
 * The built-in views' svg leaves, by their html component: what a built-in kind draws on the svg surface.
 *
 * @public
 */
export const BUILTIN_SVG_LEAVES: ReadonlyMap<ComponentType<ElementViewProps>, ComponentType<ElementViewProps>> = new Map<
  ComponentType<ElementViewProps>,
  ComponentType<ElementViewProps>
>([
  [ShapeView, ShapeSvg],
  [TextView, TextSvg],
  [ConnectorView, ConnectorSvg],
  [GroupView, GroupSvg],
  [FrameView, FrameSvg],
  [ImageView, ImageSvg],
]);

/**
 * Props of {@link ScreenSvgView}.
 *
 * @public
 */
export type ScreenSvgViewProps = {
  /** The document store. */
  readonly store: Store;
  /** The screen to draw. */
  readonly screenId: RecordId;
  /** What it is rendered for; the svg surface draws in `export` only (the mode policy's `svgSurface`). */
  readonly mode: RenderMode;
  /** The theme (default: the screen's, as core's screenThemeChoice picks it, else the light theme). */
  readonly theme?: Theme;
  /** Where element views are looked up (default: the built-ins). */
  readonly registries?: RenderRegistries;
  /** Elements a build hides (default none). */
  readonly hidden?: ReadonlySet<RecordId>;
};

/**
 * One screen of `store` as an SVG 1.1 document (the root `<svg>`): nothing outside `export` mode. Text is laid out with the
 * {@link SvgSurface} context's measurer; findings go to its `report`.
 *
 * @public
 */
export function ScreenSvgView(props: ScreenSvgViewProps): ReactNode {
  const { store, screenId } = props;
  const master = useMasterLayers(store, screenId);
  const own = useScreenTheme(store, screenId, master?.themeId);
  const theme = props.theme ?? own;
  const registries = useMemo(() => props.registries ?? builtinRegistries(), [props.registries]);
  const screen = useValue(useMemo(() => store.record$(screenId), [store, screenId])) as ScreenRecord | undefined;
  const context = useContext(SvgSurface);
  if (!modePolicy(props.mode).svgSurface || screen?.type !== 'screen') return null;
  const area = screenArea(screen);
  const background = screenBackground(screen, master, theme);
  const surface = { ...context, leaves: context.leaves ?? BUILTIN_SVG_LEAVES };
  return createElement(
    SvgSurface.Provider,
    { value: surface },
    createElement(ScreenSvg, { store, screen, area, background, master, registries, theme, hidden: props.hidden }),
  );
}

export { FrameSvg, ImageSvg } from './svg-boxes.js';
export { type SvgDiagnostic, SvgSurface, type SvgSurfaceContext } from './svg-surface.js';
