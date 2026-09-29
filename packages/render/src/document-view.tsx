// Every screen of a document, in order (FR-SCR-001, FR-DOC-010; order in screen-order.ts). The static
// render path (ssr.ts, M4.16) renders this view.
import type { Store, TextMeasurer } from '@fluxion/core';
import type { Theme } from '@fluxion/theme';
import { type ReactNode, useMemo } from 'react';
import type { AssetUrls } from './assets.js';
import { modePolicy, type RenderMode } from './mode-policy.js';
import type { RenderRegistries } from './registries.js';
import { screensInOrder } from './screen-order.js';
import { ScreenView } from './screen-view.js';
import { useValue } from './use-value.js';

/**
 * Props of {@link DocumentView}.
 *
 * @public
 */
export type DocumentViewProps = {
  /** The document store. */
  readonly store: Store;
  /** What the screens are rendered for. */
  readonly mode: RenderMode;
  /** The box each screen is fitted into. */
  readonly box: {
    /** Width, in CSS pixels. */
    readonly w: number;
    /** Height, in CSS pixels. */
    readonly h: number;
  };
  /** The theme (default: the light theme). */
  readonly theme?: Theme;
  /** Where element views are looked up. */
  readonly registries?: RenderRegistries;
  /** The URLs images are drawn from, by asset id; keep it stable (default: none, images draw nothing). */
  readonly assets?: AssetUrls;
  /** Measures text for `shrink` (default in a browser: the page's canvas measurer; none on a server). */
  readonly measurer?: TextMeasurer;
};

/**
 * Every screen of `store` in order, each a {@link ScreenView} fitted into `box`.
 *
 * @public
 */
export function DocumentView(props: DocumentViewProps): ReactNode {
  const { store, box, theme, registries, assets, measurer } = props;
  const { showHidden } = modePolicy(props.mode);
  const ids = useValue(useMemo(() => store.query((view) => screensInOrder(view, showHidden)), [store, showHidden]));
  return (
    <div className="fx-document">
      {ids.map((id) => (
        <ScreenView
          key={id}
          store={store}
          screenId={id}
          mode={props.mode}
          view={{ kind: 'fit', box }}
          {...(theme ? { theme } : {})}
          {...(registries ? { registries } : {})}
          {...(assets ? { assets } : {})}
          {...(measurer ? { measurer } : {})}
        />
      ))}
    </div>
  );
}
