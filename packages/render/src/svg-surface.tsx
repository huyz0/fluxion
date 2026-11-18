// The svg surface of <ScreenView> (ADR-0056 items 1 and 8, FR-EXP-004): the same screen, master, order and style resolution as the
// html surface, drawn as one SVG 1.1 document. Each boxed element is `<g data-el-id transform="rotate… flip…"><svg x y width height
// viewBox overflow="visible">` around its view's `Svg` leaf (SVG 1.1 has no transform on `<svg>`); members follow as siblings, since
// they are stored in screen coordinates; a connector draws in screen coordinates; the master's elements draw beneath the screen's.
// A view with no `Svg` draws a labelled placeholder and reports `FLX_EXPORT_NO_SVG_VIEW`; nothing is rasterized silently.
import type { FontSpec, MasterLayers, Store, TextMeasurer } from '@fluxion/core';
import { type AssetRecord, type ElementRecord, type FrameElement, type RecordId, type ScreenRecord, type Transform, transformRotation } from '@fluxion/schema';
import { type ResolvedPaint, resolveStyle, type Theme } from '@fluxion/theme';
import { type ComponentType, type Context, createContext, type ReactNode, useContext, useId } from 'react';
import type { AssetUrls, ImageSource } from './assets.js';
import { concreteLength } from './css-values.js';
import type { ElementViewProps, RenderRegistries } from './registries.js';
import { elementsInOrder } from './screen-order.js';
import { createFixedMeasurer } from './server-measurer.js';
import { n3, svgPaint } from './svg-paint.js';
import { MeasurerContext } from './text-measurer.js';

/**
 * A finding of an SVG export: what could not be drawn as the other surfaces draw it, by element.
 *
 * @public
 */
export type SvgDiagnostic = {
  /**
   * `FLX_EXPORT_NO_SVG_VIEW` (a view with no `Svg`: a placeholder is drawn), `FLX_EXPORT_NO_SNAPSHOT` (a component with no snapshot),
   * `FLX_EXPORT_ASSET_MISSING` (an asset with no `data:` URL is not drawn), `FLX_EXPORT_UNSUPPORTED` (a part this surface does not
   * draw yet).
   */
  readonly code: string;
  /** The element concerned. */
  readonly elementId?: string;
  /** One line. */
  readonly message: string;
};

/**
 * A run of text as glyph outlines (ADR-0056 item 5): one path in px with the pen's start at the origin on the baseline (y down), and
 * where the face draws its underline and strike, px below the baseline (negative is above), with their thickness.
 *
 * @public
 */
export type TextOutline = {
  /** The glyphs' path data, px, the pen starting at (0, 0) on the baseline. */
  readonly d: string;
  /** The underline's top, px below the baseline, and its thickness. */
  readonly underline: { readonly y: number; readonly thickness: number };
  /** The strike line's top, px below the baseline (negative: above it), and its thickness. */
  readonly strike: { readonly y: number; readonly thickness: number };
};

/**
 * What an svg-surface render reads beside the props: the measurer its text is laid out with and where its findings go.
 *
 * @public
 */
export type SvgSurfaceContext = {
  /** The measurer (default: the screen's, else the fixed advance). */
  readonly measurer?: TextMeasurer;
  /** Receives each finding. */
  readonly report?: (diagnostic: SvgDiagnostic) => void;
  /** The svg leaves of views that carry none themselves, by their html component (the built-ins'). */
  readonly leaves?: ReadonlyMap<ComponentType<ElementViewProps>, ComponentType<ElementViewProps>>;
  /** Asset bytes as `data:` URLs by asset id (images, image fills, component snapshots); an asset without one is not drawn. */
  readonly assets?: AssetUrls;
  /** The screen's theme (set by `ScreenSvgView`): what a pack view's `useExportText` resolves its style against. */
  readonly theme?: Theme;
  /** Receives the text of each piece laid out (labels, list markers, `useExportText`), in its font: the export's glyph inventory. */
  readonly glyphs?: (font: FontSpec, text: string) => void;
  /** The outline of `text` in `font`, when the export outlines it (fonts `outline`, a face with bytes); else it stays `<text>`. */
  readonly outline?: (font: FontSpec, text: string) => TextOutline | undefined;
  /** The family list to write for `font` (fonts `embed`: the embedded face's alias first, then its own list); else its own. */
  readonly family?: (font: FontSpec) => string | undefined;
};

/**
 * The svg surface's context; an exporter provides it around `<ScreenView surface="svg">`.
 *
 * @public
 */
export const SvgSurface: Context<SvgSurfaceContext> = createContext<SvgSurfaceContext>({});

const FIXED = createFixedMeasurer();

/** The measurer svg-surface text is laid out with: the export's, else the screen's, else the fixed advance. */
export function useSvgMeasurer(): TextMeasurer {
  const own = useContext(SvgSurface).measurer;
  const screen = useContext(MeasurerContext);
  return own ?? screen ?? FIXED;
}

/**
 * The drawable image of `assetId` on the svg surface: its `data:` URL (an export never refers outside the file) with the asset's
 * natural size; undefined, reported for `elementId`, when the export has none.
 */
export function useSvgImage(store: Store, assetId: string | undefined, elementId: string): ImageSource | undefined {
  const { assets, report } = useContext(SvgSurface);
  if (assetId === undefined) return undefined;
  const href = assets?.(assetId as RecordId);
  if (href === undefined || !href.startsWith('data:')) {
    report?.({ code: 'FLX_EXPORT_ASSET_MISSING', elementId, message: `asset ${assetId} has no data URL here: it is not drawn` });
    return undefined;
  }
  const record = store.get(assetId as RecordId);
  const asset = record?.type === 'asset' ? (record as AssetRecord) : undefined;
  return { href, ...(asset?.w === undefined ? {} : { w: asset.w }), ...(asset?.h === undefined ? {} : { h: asset.h }) };
}

/** The finding reporter of the svg surface (nothing when none listens). */
export const useSvgReport = (): ((d: SvgDiagnostic) => void) => useContext(SvgSurface).report ?? (() => undefined);

/** A view's `Svg` leaf when it has none: its box dashed, its kind written in it, and a finding. */
export function SvgPlaceholder(props: ElementViewProps): ReactNode {
  const report = useSvgReport();
  const t = (props.element as { readonly transform?: Transform }).transform;
  const snapshotId = (props.element as { readonly snapshotAssetId?: string }).snapshotAssetId;
  const snapshot = useSvgImage(props.store, snapshotId, props.element.id);
  // a component is drawn from its rendered snapshot (ADR-0056 item 9); without one it gets the placeholder
  if (snapshot !== undefined && t !== undefined)
    return <image x={0} y={0} width={n3(t.w)} height={n3(t.h)} preserveAspectRatio="none" xlinkHref={snapshot.href} />;
  if (props.element.kind === 'component' && snapshotId === undefined)
    report({ code: 'FLX_EXPORT_NO_SNAPSHOT', elementId: props.element.id, message: 'the component has no snapshot: a placeholder is drawn' });
  else if (snapshotId === undefined)
    report({ code: 'FLX_EXPORT_NO_SVG_VIEW', elementId: props.element.id, message: `${props.element.kind} has no SVG view: a placeholder is drawn` });
  if (t === undefined) return null;
  const label = `Unsupported element: ${props.element.kind}`;
  return (
    <g>
      <title>{label}</title>
      <rect x={0} y={0} width={n3(t.w)} height={n3(t.h)} fill="#f3f4f6" stroke="#9ca3af" strokeDasharray="4 4" />
      <text x={n3(t.w / 2)} y={n3(t.h / 2)} textAnchor="middle" fontFamily="sans-serif" fontSize={12} fill="#6b7280">
        {props.element.kind}
      </text>
    </g>
  );
}

/** The transform of a boxed element's group: its rotation and flips about its centre. */
function turn(t: Transform): string | undefined {
  const [cx, cy] = [n3(t.x + t.w / 2), n3(t.y + t.h / 2)];
  const r = n3(transformRotation(t));
  const parts = [r === 0 ? '' : `rotate(${r} ${cx} ${cy})`];
  if (t.flipX || t.flipY) parts.push(`translate(${cx} ${cy}) scale(${t.flipX ? -1 : 1} ${t.flipY ? -1 : 1}) translate(${-cx} ${-cy})`);
  const joined = parts.filter(Boolean).join(' ');
  return joined === '' ? undefined : joined;
}

type ListProps = {
  readonly store: Store;
  readonly screenId: RecordId;
  readonly parentId?: RecordId | undefined;
  readonly registries: RenderRegistries;
  readonly theme: Theme;
  readonly hidden?: ReadonlySet<RecordId> | undefined;
  readonly leaves?: SvgSurfaceContext['leaves'];
};

/**
 * The clip of a frame's members (ADR-0052, ADR-0056 item 8): its box with its corner radius, in screen coordinates and turned as the
 * frame is; undefined for anything else and for a frame with `clip: false`.
 */
function frameClip(element: ElementRecord, theme: Theme, id: string): ReactNode {
  // kind-switch-allow: a frame is the one kind whose members are clipped by its box
  if (element.kind !== 'frame') return undefined;
  const frame = element as FrameElement;
  if (frame.clip === false) return undefined;
  const t = frame.transform;
  const { style } = resolveStyle(frame.style, 'frame', theme, ['records', frame.id, 'style']);
  const radius = concreteLength(style.radius, theme);
  return (
    <clipPath id={id}>
      <rect x={n3(t.x)} y={n3(t.y)} width={n3(t.w)} height={n3(t.h)} rx={radius > 0 ? n3(radius) : undefined} transform={turn(t)} />
    </clipPath>
  );
}

/** One element drawn by its view's `Svg` leaf, then its members. */
function SvgElementNode(props: Omit<ListProps, 'parentId'> & { readonly id: RecordId }): ReactNode {
  const { store, id, registries, theme } = props;
  const clipId = `fx-frame-${useId().replace(/[^\w-]/g, '')}`;
  const element = store.get(id) as ElementRecord | undefined;
  if (element?.type !== 'element') return null;
  const view = registries.elementViews.get(element.kind);
  const View = view?.Svg ?? (view === undefined ? undefined : props.leaves?.get(view.Component)) ?? SvgPlaceholder;
  const words = store.query((v) => view?.a11y?.(element, v))();
  const t = (element as { readonly transform?: Transform }).transform;
  const leaf = <View element={element} store={store} theme={theme} registries={registries} />;
  const clip = frameClip(element, theme, clipId);
  const members = <SvgElementList {...props} parentId={id} />;
  return (
    <>
      <g data-el-id={id} transform={t === undefined ? undefined : turn(t)}>
        {words === undefined ? null : <title>{words}</title>}
        {t === undefined ? (
          leaf
        ) : (
          // biome-ignore lint/a11y/noSvgWithoutTitle: the element's words are the title of the group around it
          <svg x={n3(t.x)} y={n3(t.y)} width={n3(t.w)} height={n3(t.h)} viewBox={`0 0 ${n3(t.w)} ${n3(t.h)}`} overflow="visible">
            {leaf}
          </svg>
        )}
      </g>
      {clip === undefined ? (
        members
      ) : (
        <>
          <defs>{clip}</defs>
          <g clipPath={`url(#${clipId})`}>{members}</g>
        </>
      )}
    </>
  );
}

/** The visible elements under `parentId` (or at the root of `screenId`), back to front. */
function SvgElementList(props: ListProps): ReactNode {
  const { store, screenId, parentId, hidden } = props;
  const ids = store.query((view) => elementsInOrder(view, screenId, parentId))();
  return ids.filter((id) => hidden?.has(id) !== true).map((id) => <SvgElementNode key={id} {...props} id={id} />);
}

/** Props of {@link ScreenSvg}. */
export type ScreenSvgProps = {
  readonly store: Store;
  readonly screen: ScreenRecord;
  readonly area: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly background: ResolvedPaint;
  readonly master: MasterLayers | undefined;
  readonly registries: RenderRegistries;
  readonly theme: Theme;
  readonly hidden?: ReadonlySet<RecordId> | undefined;
  /** A selection export (ADR-0056 item 6): where its lists start, in paint order, and its viewBox; no master and no background. */
  readonly selection?:
    | { readonly roots: readonly RecordId[]; readonly box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number } }
    | undefined;
};

/** One screen as an SVG 1.1 document: its background, its master's elements, then its own; a selection's elements alone. */
export function ScreenSvg(props: ScreenSvgProps): ReactNode {
  const { store, screen, area, background, master, registries, theme } = props;
  const leaves = useContext(SvgSurface).leaves;
  const id = `fx-bg-${useId().replace(/[^\w-]/g, '')}`;
  const { fill, defs } = svgPaint(background, id, area, theme);
  const masterHidden = new Set([...(master?.placeholders ?? []), ...(props.hidden ?? [])]);
  const name = (screen as { readonly name?: string }).name;
  const alt = (screen as { readonly alt?: string }).alt;
  const { selection } = props;
  if (selection !== undefined) {
    const b = selection.box;
    const list = { store, screenId: screen.id, registries, theme, hidden: props.hidden, leaves };
    return (
      <svg
        version="1.1"
        xmlns="http://www.w3.org/2000/svg"
        xmlnsXlink="http://www.w3.org/1999/xlink"
        width={n3(b.w)}
        height={n3(b.h)}
        viewBox={`${n3(b.x)} ${n3(b.y)} ${n3(b.w)} ${n3(b.h)}`}
        data-screen-id={screen.id}
      >
        <title>{name ?? screen.id}</title>
        {alt === undefined ? null : <desc>{alt}</desc>}
        {selection.roots.map((id) => (
          <SvgElementNode key={id} {...list} id={id} />
        ))}
      </svg>
    );
  }
  return (
    <svg
      version="1.1"
      xmlns="http://www.w3.org/2000/svg"
      xmlnsXlink="http://www.w3.org/1999/xlink"
      width={n3(area.w)}
      height={n3(area.h)}
      viewBox={`${n3(area.x)} ${n3(area.y)} ${n3(area.w)} ${n3(area.h)}`}
      data-screen-id={screen.id}
    >
      <title>{name ?? screen.id}</title>
      {alt === undefined ? null : <desc>{alt}</desc>}
      {defs === undefined ? null : <defs>{defs}</defs>}
      {fill === 'none' ? null : <rect x={n3(area.x)} y={n3(area.y)} width={n3(area.w)} height={n3(area.h)} fill={fill} />}
      {master === undefined || !master.elements ? null : (
        <g data-master-id={master.master}>
          <SvgElementList store={store} screenId={master.master} registries={registries} theme={theme} hidden={masterHidden} leaves={leaves} />
        </g>
      )}
      <SvgElementList store={store} screenId={screen.id} registries={registries} theme={theme} hidden={props.hidden} leaves={leaves} />
    </svg>
  );
}
