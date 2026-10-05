// The present-mode root (FR-EDT-009 part; the full player lands in M11): the document's first visible
// screen, fitted into the root, drawn by the same <ScreenView> as the editor (FR-EDT-010).
import type { Store } from '@fluxion/core';
import { presentationOrder, type RenderRegistries, ScreenView, useValue } from '@fluxion/render';
import { type ReactNode, useMemo, useRef } from 'react';
import { useElementBox } from './use-box.js';

/**
 * Props of {@link PlayerRoot}.
 *
 * @public
 */
export type PlayerRootProps = {
  /** The document store. */
  readonly store: Store;
  /** Where element views, shapes and markers are looked up. */
  readonly registries: RenderRegistries;
  /** The colour of the bars a screen of another shape leaves around it (a CSS colour; default black). */
  readonly background?: string;
};

/**
 * The document presented: its first visible screen, fitted into the root.
 *
 * @public
 */
export function PlayerRoot(props: PlayerRootProps): ReactNode {
  const { store, registries } = props;
  const ref = useRef<HTMLDivElement>(null);
  const box = useElementBox(ref);
  const first = useValue(useMemo(() => store.query((view) => presentationOrder(view, false)[0]), [store]));
  return (
    <div ref={ref} className="fx-player" data-testid="player-root" style={{ position: 'fixed', inset: 0, background: props.background ?? '#000' }}>
      {first === undefined || box.w === 0 ? null : (
        <ScreenView store={store} screenId={first} mode="present" view={{ kind: 'fit', box }} registries={registries} />
      )}
    </div>
  );
}
