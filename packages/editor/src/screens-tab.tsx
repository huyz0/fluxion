// The Screens tab (FR-EDT-006, M7.6): the document's screens in order, the one the canvas shows marked;
// a click shows another. Thumbnails, reorder and rename are the navigator's (M8).
import type { Store } from '@fluxion/core';
import { screensInOrder, useValue } from '@fluxion/render';
import type { RecordId, ScreenRecord } from '@fluxion/schema';
import { type ReactNode, useMemo } from 'react';
import { screenLabel } from './screen-switch.js';
import type { Session } from './session.js';

/** Props of {@link ScreensTab}. */
export type ScreensTabProps = {
  /** The document store. */
  readonly store: Store;
  /** The session whose shown screen it reads and sets. */
  readonly session: Session;
  /** The screen the canvas shows now. */
  readonly shown: RecordId | undefined;
};

/** The screens as `{id, label}` rows, hidden ones included (they are edited too). */
const rowsOf = (store: Store) =>
  store.query((view) => screensInOrder(view, true).map((id, i) => ({ id, label: screenLabel((view.get(id) as ScreenRecord | undefined)?.name, i) })));

/** A button per screen; the shown one is pressed. */
export function ScreensTab(props: ScreensTabProps): ReactNode {
  const { store, session, shown } = props;
  const rows = useValue(useMemo(() => rowsOf(store), [store]));
  return (
    <ul className="fx-chrome-screens" aria-label="Screens">
      {rows.map((r) => (
        <li key={r.id}>
          <button type="button" className="fx-chrome-button" aria-pressed={r.id === shown} onClick={() => session.screen.set(r.id)}>
            {r.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
