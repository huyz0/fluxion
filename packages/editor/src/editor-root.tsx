// The edit-mode root (FR-EDT-001): the document's first screen drawn by the same <ScreenView> as
// present mode (FR-EDT-010), fitted into the canvas. The chrome (M6.5), camera (M6.8) and tools
// (M6.11) build on this root.
import type { Store } from '@fluxion/core';
import { useElementBox } from '@fluxion/player';
import { type RenderRegistries, ScreenView, screensInOrder, useValue } from '@fluxion/render';
import { type ReactNode, useMemo, useRef } from 'react';

/**
 * Props of {@link EditorRoot}.
 *
 * @public
 */
export type EditorRootProps = {
  /** The document store. */
  readonly store: Store;
  /** Where element views, shapes and markers are looked up. */
  readonly registries: RenderRegistries;
};

/**
 * The editor for the document in `store`: its first screen on the canvas.
 *
 * @public
 */
export function EditorRoot(props: EditorRootProps): ReactNode {
  const { store, registries } = props;
  const ref = useRef<HTMLElement>(null);
  const box = useElementBox(ref);
  // hidden screens are edited too
  const first = useValue(useMemo(() => store.query((view) => screensInOrder(view, true)[0]), [store]));
  return (
    <div className="fx-editor" data-testid="editor-root" style={{ position: 'fixed', inset: 0, display: 'flex' }}>
      <main ref={ref} aria-label="Canvas" className="fx-chrome-canvas" style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#e2e8f0' }}>
        {first === undefined || box.w === 0 ? null : (
          <ScreenView store={store} screenId={first} mode="edit" view={{ kind: 'fit', box }} registries={registries} />
        )}
      </main>
    </div>
  );
}
