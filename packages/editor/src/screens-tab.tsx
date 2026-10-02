// The Screens tab, the navigator (FR-EDT-006, FR-SCR-002, M8.12): the document's screens in order, each with a
// thumbnail; a click shows one, a drag reorders, a double-click renames in place, the eye hides it from presentation
// and a right click opens the screen's menu (rename, hide, duplicate, delete). The screen the canvas shows is marked.
import type { Store } from '@fluxion/core';
import { type RenderRegistries, screensInOrder, useValue } from '@fluxion/render';
import type { RecordId, ScreenRecord } from '@fluxion/schema';
import { type ReactNode, useMemo } from 'react';
import { ContextMenu } from './context-menu.js';
import type { MenuItem } from './context-menu-model.js';
import { FORMAT_ITEMS, formatLabel, shownSize } from './navigator/navigator-model.js';
import { type Row, ScreenRow } from './navigator/screen-row.js';
import { useNavigator } from './navigator/use-navigator.js';
import type { Execute } from './pointer.js';
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
  /** Where thumbnails are drawn from; without it (and `execute`) the tab is a plain list. */
  readonly registries?: RenderRegistries | undefined;
  /** Runs the screen commands. */
  readonly execute?: Execute | undefined;
  /** Where fresh record ids come from. */
  readonly newId?: (() => RecordId) | undefined;
};

/** The screens as rows, hidden ones included (they are edited too). */
const rowsOf = (store: Store) =>
  store.query((view) =>
    screensInOrder(view, true).map((id, i): Row => {
      const r = view.get(id) as ScreenRecord | undefined;
      return { id, label: screenLabel(r?.name, i), hidden: r?.hidden === true, format: formatLabel(r ?? {}), size: shownSize(r ?? {}) };
    }),
  );

const NO_KEYS = (): readonly string[] => [];

/** The menu of a screen's row. */
const itemsOf = (row: Row | undefined): readonly MenuItem[] => [
  { command: 'screen.rename', title: 'Rename' },
  ...FORMAT_ITEMS,
  { command: 'screen.setHidden', title: row?.hidden ? 'Show in presentation' : 'Hide from presentation' },
  { command: 'screen.duplicate', title: 'Duplicate' },
  { command: 'screen.delete', title: 'Delete' },
];

/** The navigator: a row per screen; the shown one is pressed. */
export function ScreensTab(props: ScreensTabProps): ReactNode {
  const { store, session, shown, registries, execute, newId } = props;
  const rows = useValue(useMemo(() => rowsOf(store), [store]));
  const nav = useNavigator({ store, session, rows, execute, newId });
  const editable = nav.actions !== undefined && newId !== undefined;
  return (
    <>
      {editable ? (
        <button type="button" className="fx-chrome-button" onClick={nav.add}>
          New screen
        </button>
      ) : null}
      <ul className="fx-chrome-screens" aria-label="Screens">
        {rows.map((r) => (
          <ScreenRow
            key={r.id}
            row={r}
            store={store}
            session={session}
            current={r.id === shown}
            state={{ renaming: nav.renaming === r.id, sizing: nav.sizing === r.id, dragging: nav.dragging === r.id, dropping: nav.dragging !== undefined }}
            registries={registries}
            actions={nav.actions}
          />
        ))}
      </ul>
      {nav.menu === undefined ? null : (
        <ContextMenu
          items={itemsOf(rows.find((r) => r.id === nav.menu?.id))}
          at={{ x: nav.menu.x, y: nav.menu.y }}
          keysOf={NO_KEYS}
          onPick={nav.pick}
          onClose={nav.closeMenu}
        />
      )}
    </>
  );
}
