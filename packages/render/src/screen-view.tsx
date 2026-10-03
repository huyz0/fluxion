// <ScreenView> (04 §2.1-§2.2, ADR-0015): one screen of a store, the same component in edit, present
// and export. The `.fx-screen` root carries the theme's CSS variables and the fit transform; its layers
// are the background, the content (the elements, drawn by their registered views) and the editor's
// overlay slot (edit only).
import type { Store, TextMeasurer } from '@fluxion/core';
import type { RecordId, ScreenRecord } from '@fluxion/schema';
import { resolveBackground, styleKey, type Theme, toCssVars } from '@fluxion/theme';
import { type CSSProperties, type ReactNode, useInsertionEffect, useMemo } from 'react';
import { AssetsContext, type AssetUrls } from './assets.js';
import { paintCss } from './background.js';
import { builtinRegistries } from './builtins.js';
import { CONTENT_CSS } from './content-css.js';
import { ElementList } from './elements.js';
import { cameraTransform, fitTransform, screenArea } from './fit.js';
import { modePolicy, type RenderMode } from './mode-policy.js';
import type { RenderRegistries } from './registries.js';
import { useScreenTheme } from './screen-theme.js';
import { MeasurerContext } from './text-measurer.js';
import { useValue } from './use-value.js';

/**
 * A box in CSS pixels.
 *
 * @public
 */
export type ViewBox = {
  /** Width. */
  readonly w: number;
  /** Height. */
  readonly h: number;
};

/**
 * How a screen is shown: fitted into a box (present mode), or through a camera (the editor canvas):
 * page point p at (p - (x, y)) * z in the box.
 *
 * @public
 */
export type ScreenViewSpec =
  | {
      /** View type. */
      readonly kind: 'fit';
      /** The box to fit into, in CSS pixels. */
      readonly box: ViewBox;
    }
  | {
      /** View type. */
      readonly kind: 'camera';
      /** The box drawn into, in CSS pixels. */
      readonly box: ViewBox;
      /** The page point at the box's top-left (`x`, `y`) and the zoom `z`. */
      readonly camera: {
        /** Page x at the box's left edge. */
        readonly x: number;
        /** Page y at the box's top edge. */
        readonly y: number;
        /** Zoom: box px per page unit. */
        readonly z: number;
      };
    };

/**
 * Props of {@link ScreenView}.
 *
 * @public
 */
export type ScreenViewProps = {
  /** The document store. */
  readonly store: Store;
  /** The screen to show. */
  readonly screenId: RecordId;
  /** What the screen is rendered for; only `mode-policy.ts` reads it. */
  readonly mode: RenderMode;
  /** How the screen is shown. */
  readonly view: ScreenViewSpec;
  /** The theme whose tokens become the screen's CSS variables (default: the screen's own or the document's, else the light theme). */
  readonly theme?: Theme;
  /** Editor chrome in screen coordinates, mounted in edit mode only. */
  readonly editOverlay?: ReactNode;
  /** Where element views are looked up (default: the built-in views, {@link builtinRegistries}). */
  readonly registries?: RenderRegistries;
  /** The URLs images are drawn from, by asset id; keep it stable (default: none, images draw nothing). */
  readonly assets?: AssetUrls;
  /** Measures text for `shrink` (default in a browser: the page's canvas measurer; none on a server). */
  readonly measurer?: TextMeasurer;
  /** Extra content drawn above the elements. */
  readonly children?: ReactNode;
};

/** Content CSS injected once per document in the browser (SSR inlines it instead; ADR-0015). */
function useContentCss(): void {
  useInsertionEffect(() => {
    if (document.querySelector('style[data-fx-content]')) return;
    const style = document.createElement('style');
    style.dataset['fxContent'] = '';
    style.textContent = CONTENT_CSS;
    document.head.append(style);
  }, []);
}

/**
 * One screen of `store` in `view.box`, fitted or through a camera, styled by `theme`.
 *
 * @public
 */
export function ScreenView(props: ScreenViewProps): ReactNode {
  const { store, screenId, view, editOverlay, children } = props;
  const own = useScreenTheme(store, screenId);
  const theme = props.theme ?? own;
  const registries = useMemo(() => props.registries ?? builtinRegistries(), [props.registries]);
  const policy = modePolicy(props.mode);
  useContentCss();
  const screen = useValue(useMemo(() => store.record$(screenId), [store, screenId])) as ScreenRecord | undefined;
  const vars = useMemo(() => toCssVars(theme), [theme]);
  // views resolve styles against the theme's structure; colour values reach them as CSS variables, so
  // a change of colours alone restyles without re-rendering them (04 §2.3, ADR-0015 amendment)
  const key = useMemo(() => styleKey(theme), [theme]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the structure, see above
  const styling = useMemo(() => theme, [key]);
  if (!screen || screen.type !== 'screen') return null;
  const area = screenArea(screen);
  const background = resolveBackground(screen.background, theme, ['records', screenId]).paint;
  const fit = view.kind === 'camera' ? cameraTransform(area, view.camera) : fitTransform(area, view.box);
  const style = {
    ...vars,
    // what a connector label knocks its background out with: the screen's own colour (none for a
    // gradient or image), not the theme's (M5.22 review F1)
    '--fx-screen-background': background.type === 'color' ? background.css : 'transparent',
    width: area.w,
    height: area.h,
    transform: `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})`,
  } as CSSProperties;
  // an infinite screen shows its viewport: the content moves so the viewport's corner is the origin
  const origin = area.x !== 0 || area.y !== 0 ? { transform: `translate(${-area.x}px, ${-area.y}px)` } : undefined;
  return (
    <AssetsContext.Provider value={props.assets}>
      <MeasurerContext.Provider value={props.measurer}>
        <div className="fx-view" style={{ width: view.box.w, height: view.box.h }}>
          <section className="fx-screen" data-screen-id={screenId} data-interactive={policy.interactive ? '' : undefined} style={style}>
            <div className="fx-layer fx-background" style={paintCss(background)} data-asset-id={background.type === 'image' ? background.assetId : undefined} />
            <div className="fx-layer fx-content" style={origin}>
              <ElementList store={store} screenId={screenId} registries={registries} theme={styling} />
              {children}
            </div>
            {policy.editOverlay && editOverlay !== undefined ? <div className="fx-layer fx-overlay">{editOverlay}</div> : null}
          </section>
        </div>
      </MeasurerContext.Provider>
    </AssetsContext.Provider>
  );
}
