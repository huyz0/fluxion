// <ScreenView> (04 §2.1-§2.2, ADR-0015): one screen of a store, the same component in edit, present
// and export. The `.fx-screen` root carries the theme's CSS variables and the fit transform; its layers
// are the background, the content (element views, M4.13) and the editor's overlay slot (edit only).
import type { Store } from '@fluxion/core';
import type { RecordId, ScreenRecord } from '@fluxion/schema';
import { LIGHT_THEME, type Theme, toCssVars } from '@fluxion/theme';
import { type CSSProperties, type ReactNode, useInsertionEffect, useMemo } from 'react';
import { CONTENT_CSS } from './content-css.js';
import { fitTransform, screenArea } from './fit.js';
import { modePolicy, type RenderMode } from './mode-policy.js';
import { useValue } from './use-value.js';

/**
 * How a screen is shown: fitted into a box (camera views arrive with the editor, M6).
 *
 * @public
 */
export type ScreenViewSpec = {
  /** View type. */
  readonly kind: 'fit';
  /** The box to fit into, in CSS pixels. */
  readonly box: {
    /** Width. */
    readonly w: number;
    /** Height. */
    readonly h: number;
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
  /** The theme whose tokens become the screen's CSS variables (default: the light theme). */
  readonly theme?: Theme;
  /** Editor chrome in screen coordinates, mounted in edit mode only. */
  readonly editOverlay?: ReactNode;
  /** The content layer's children (element views; M4.13 renders them from the registry). */
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
 * One screen of `store`, fitted into `view.box`, styled by `theme`.
 *
 * @public
 */
export function ScreenView(props: ScreenViewProps): ReactNode {
  const { store, screenId, view, theme = LIGHT_THEME, editOverlay, children } = props;
  const policy = modePolicy(props.mode);
  useContentCss();
  const screen = useValue(useMemo(() => store.record$(screenId), [store, screenId])) as ScreenRecord | undefined;
  const vars = useMemo(() => toCssVars(theme), [theme]);
  if (!screen || screen.type !== 'screen') return null;
  const area = screenArea(screen);
  const fit = fitTransform(area, view.box);
  const style = {
    ...vars,
    width: area.w,
    height: area.h,
    transform: `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})`,
  } as CSSProperties;
  // an infinite screen shows its viewport: the content moves so the viewport's corner is the origin
  const origin = area.x !== 0 || area.y !== 0 ? { transform: `translate(${-area.x}px, ${-area.y}px)` } : undefined;
  return (
    <div className="fx-view" style={{ width: view.box.w, height: view.box.h }}>
      <section className="fx-screen" data-screen-id={screenId} data-interactive={policy.interactive ? '' : undefined} style={style}>
        <div className="fx-layer fx-background" />
        <div className="fx-layer fx-content" style={origin}>
          {children}
        </div>
        {policy.editOverlay && editOverlay !== undefined ? <div className="fx-layer fx-overlay">{editOverlay}</div> : null}
      </section>
    </div>
  );
}
