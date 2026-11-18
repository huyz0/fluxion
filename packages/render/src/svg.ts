// `@fluxion/render/svg` (ADR-0056 item 1, FR-EXP-004): a screen on the svg surface. The same store reads as <ScreenView> (the applied
// master, the screen's theme as core picks it, its background, the element order and the registered views), drawn as one SVG 1.1
// document by each view's `Svg` leaf, the built-in views' leaves supplied here. Its own entry, so the player and the editor's
// initial bundle never carry it (NFR-SIZE-001/002); the exporters render it with react-dom/server.
import type { Store, TextMeasurer } from '@fluxion/core';
import type { Box } from '@fluxion/geometry';
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
import { ConnectorSvg, connectorExtent } from './svg-connector.js';
import { selectionRoots, selectionScope, selectionViewBox } from './svg-selection.js';
import { ScreenSvg, SvgSurface, useSvgMeasurer } from './svg-surface.js';
import { TableSvg } from './svg-table.js';
import { GroupSvg, ShapeSvg, TextSvg } from './svg-views.js';
import { TableView } from './table-view.js';
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
  [TableView, TableSvg],
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
  /**
   * Export these elements of the screen instead of all of it (ADR-0056 item 6): with their members, connectors whose two ends are
   * drawn, no master or background, in a viewBox of their outset world bounds rounded out to whole px.
   */
  readonly selection?: readonly RecordId[];
};

/** A selection's lists, hidden elements and viewBox (the screen area when nothing drawn has a box). */
function scope(
  store: Store,
  screenId: RecordId,
  selected: readonly RecordId[],
  frame: { readonly theme: Theme; readonly area: Box; readonly registries: RenderRegistries; readonly measurer: TextMeasurer },
) {
  const { theme, area } = frame;
  const { drawn, hidden, roots } = store.query((view) => {
    const scoped = selectionScope(view, screenId, selected);
    return { ...scoped, roots: selectionRoots(view, screenId, scoped.drawn) };
  })();
  // a connector's extent reads its route and hops as signals of their own, so outside the view's query
  const extents = new Map<RecordId, Box | undefined>();
  for (const id of drawn) {
    if ((store.get(id) as { readonly transform?: unknown } | undefined)?.transform === undefined) {
      extents.set(id, connectorExtent(store, frame.registries, id, { theme, measurer: frame.measurer, hidden }));
    }
  }
  const box = store.query((view) => selectionViewBox(view, drawn, theme, (id) => extents.get(id)))() ?? area;
  return { hidden, selection: { roots, box } };
}

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
  const measurer = useSvgMeasurer();
  if (!modePolicy(props.mode).svgSurface || screen?.type !== 'screen') return null;
  const area = screenArea(screen);
  const background = screenBackground(screen, master, theme);
  const surface = { ...context, theme, leaves: context.leaves ?? BUILTIN_SVG_LEAVES };
  const scoped = props.selection === undefined ? undefined : scope(store, screenId, props.selection, { theme, area, registries, measurer });
  const hidden = scoped === undefined ? props.hidden : new Set([...(props.hidden ?? []), ...scoped.hidden]);
  return createElement(
    SvgSurface.Provider,
    { value: surface },
    createElement(ScreenSvg, { store, screen, area, background, master, registries, theme, hidden, selection: scoped?.selection }),
  );
}

export { ExportContext, type ExportLine, type ExportMarks, type ExportPiece, type ExportText, type Svg, useExportText } from './export-text.js';
export { FrameSvg, ImageSvg } from './svg-boxes.js';
export { type SelectionScope, selectionScope, selectionViewBox } from './svg-selection.js';
export { type SvgDiagnostic, SvgSurface, type SvgSurfaceContext, type TextOutline } from './svg-surface.js';
export { TableSvg } from './svg-table.js';
