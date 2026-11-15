// The overlay's find highlights (FR-EDT-016): every element the find bar's query finds on the shown screen is outlined, the
// current match more strongly. Drawn only: the find bar (find-bar.tsx) holds the query.
import type { Store } from '@fluxion/core';
import { useValue } from '@fluxion/render';
import type { RecordId } from '@fluxion/schema';
import { type ReactNode, useMemo } from 'react';
import { keyIds, matchKey } from './find-model.js';
import { placements, selectionFrame } from './overlay-geometry.js';
import { shownScreen } from './screen-switch.js';
import type { Session } from './session.js';

/** Props of {@link FindMarks}. */
export type FindMarksProps = {
  /** The document store. */
  readonly store: Store;
  /** The session whose find state, screen and camera it draws. */
  readonly session: Session;
};

/** The ids the find bar's query finds on the shown screen as a {@link matchKey} (empty without a store). */
function useShownKey(store: Store | undefined, session: Session): string {
  const query = useValue(session.find.get)?.query ?? '';
  const wanted = useValue(session.screen.get);
  return useValue(
    useMemo(() => (store === undefined ? () => '' : store.query((view) => matchKey(view, query, shownScreen(view, wanted)))), [store, query, wanted]),
  );
}

/** Whether the find bar's query finds anything on the shown screen (none without a store); a boolean, so a drag does not re-render its user. */
export function useFindShown(store: Store | undefined, session: Session): boolean {
  return useShownKey(store, session) !== '';
}

/** An outline around each match on the shown screen. */
export function FindMarks(props: FindMarksProps): ReactNode {
  const { store, session } = props;
  const camera = useValue(session.camera.get);
  const current = useValue(session.find.get)?.current;
  const key = useShownKey(store, session);
  const ids = useMemo(() => keyIds(key), [key]);
  const placed = useValue(useMemo(() => store.query((view) => ids.map((id) => ({ id, at: placements(view, [id]) }))), [store, ids]));
  return placed.map(({ id, at }) => {
    const frame = selectionFrame(at, camera);
    if (frame === undefined) return null;
    return (
      <polygon
        key={id}
        className={id === current ? 'fx-chrome-find-match fx-chrome-find-current' : 'fx-chrome-find-match'}
        data-find-match={id}
        points={frame.corners.map((p) => `${p.x},${p.y}`).join(' ')}
      />
    );
  });
}
