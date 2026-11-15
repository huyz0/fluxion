// The Screens tab, the navigator (FR-EDT-006, FR-SCR-002, M8.12): the document's screens in order, each with a
// thumbnail; a click shows one, a drag reorders, a double-click renames in place, the eye hides it from presentation
// and a right click opens the screen's menu (rename, hide, duplicate, delete). The screen the canvas shows is marked. Master
// screens are listed apart, after the screens (FR-SCR-005, ADR-0054).
import type { ReadView, Store } from '@fluxion/core';
import { mastersInOrder, type RenderRegistries, screensInOrder, useValue } from '@fluxion/render';
import { routeConnector } from '@fluxion/routing';
import type { RecordId, ScreenRecord } from '@fluxion/schema';
import { t } from '@lingui/core/macro';
import './i18n.js';
import { type ReactNode, useMemo } from 'react';
import { ContextMenu } from './context-menu.js';
import type { MenuItem } from './context-menu-model.js';
import { FORMAT_ITEMS, formatLabel, navigatorItems, type Row, type SectionRow, sectionMoves, shownSize } from './navigator/navigator-model.js';
import { ScreenRow } from './navigator/screen-row.js';
import { SectionHeader } from './navigator/section-header.js';
import { useNavigator } from './navigator/use-navigator.js';
import { SECTION_ITEMS, useSections } from './navigator/use-sections.js';
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

/** The screen `id` as a row, labelled `label` when it has no name. */
const rowOf = (view: ReadView, id: RecordId, label: (name: string | undefined) => string, master = false): Row => {
  const r = view.get(id) as ScreenRecord | undefined;
  return {
    id,
    label: label(r?.name),
    hidden: r?.hidden === true,
    format: formatLabel(r ?? {}),
    size: shownSize(r ?? {}),
    // a master belongs to no section: it is listed apart
    sectionId: master ? undefined : r?.sectionId,
  };
};

/** The screens as rows, hidden ones included (they are edited too); masters are not among them. */
const rowsOf = (store: Store) => store.query((view) => screensInOrder(view, true).map((id, i) => rowOf(view, id, (name) => screenLabel(name, i))));

/** The master screens as rows (FR-SCR-005, ADR-0054): the navigator's masters section. */
const masterRowsOf = (store: Store) =>
  store.query((view) =>
    mastersInOrder(view).map((id, i) => rowOf(view, id, (name) => (name === undefined || name.trim() === '' ? t`Master ${i + 1}` : name), true)),
  );

/** The sections in order. */
const sectionsOf = (store: Store) =>
  store.query((view) =>
    view
      .members('byType', 'section')
      .map((id) => ({ id, ...(view.get(id) as { name?: string; index?: string; collapsed?: boolean }) }))
      .sort((a, b) => (String(a.index) < String(b.index) ? -1 : 1))
      .map((s): SectionRow => ({ id: s.id, name: s.name ?? '', collapsed: s.collapsed === true })),
  );

const NO_KEYS = (): readonly string[] => [];

/** The menu of a screen's row. */
const itemsOf = (row: Row | undefined, sections: readonly SectionRow[]): readonly MenuItem[] => [
  { command: 'screen.rename', title: 'Rename' },
  ...FORMAT_ITEMS,
  ...sectionMoves(sections, row?.sectionId),
  { command: 'screen.setHidden', title: row?.hidden ? 'Show in presentation' : 'Hide from presentation' },
  { command: 'screen.duplicate', title: 'Duplicate' },
  { command: 'screen.delete', title: 'Delete' },
];

/** The masters section: the master screens apart from the screens, shown when there is one (FR-SCR-005, ADR-0054). */
function MastersList(props: {
  readonly rows: readonly Row[];
  readonly store: Store;
  readonly session: Session;
  readonly shown: RecordId | undefined;
  readonly registries: RenderRegistries | undefined;
  readonly nav: ReturnType<typeof useNavigator>;
}): ReactNode {
  const { rows, store, session, shown, registries, nav } = props;
  if (rows.length === 0) return null;
  return (
    <ul className="fx-chrome-screens fx-chrome-masters" aria-label={t`Masters`}>
      {rows.map((row) => (
        <ScreenRow
          key={row.id}
          row={row}
          store={store}
          session={session}
          current={row.id === shown}
          state={{ renaming: nav.renaming === row.id, sizing: nav.sizing === row.id, dragging: false, dropping: false }}
          registries={registries}
          actions={nav.actions}
        />
      ))}
    </ul>
  );
}

/** The navigator: the screens by section, each with its thumbnail; the shown one is pressed. */
export function ScreensTab(props: ScreensTabProps): ReactNode {
  const { store, session, shown, registries, execute, newId } = props;
  const rows = useValue(useMemo(() => rowsOf(store), [store]));
  const masters = useValue(useMemo(() => masterRowsOf(store), [store]));
  const sections = useValue(useMemo(() => sectionsOf(store), [store]));
  const endPoint = useMemo(
    () => (registries === undefined ? undefined : (id: RecordId, end: 'source' | 'target') => routeConnector(store, registries, id)?.[end].point),
    [store, registries],
  );
  const nav = useNavigator({ store, session, rows, execute, newId, endPoint });
  const sec = useSections({ sections, execute, newId, dragging: nav.dragging });
  const editable = nav.actions !== undefined && newId !== undefined;
  return (
    <>
      {editable ? (
        <div className="fx-chrome-navigator-actions">
          <button type="button" className="fx-chrome-button" onClick={nav.add}>
            {t`New screen`}
          </button>
          <button type="button" className="fx-chrome-button" onClick={sec.add}>
            {t`New section`}
          </button>
        </div>
      ) : null}
      <ul className="fx-chrome-screens" aria-label={t`Screens`}>
        {navigatorItems(rows, sections).map((item) =>
          item.kind === 'section' ? (
            <SectionHeader
              key={item.section.id}
              section={item.section}
              count={item.count}
              renaming={sec.renaming === item.section.id}
              dropping={nav.dragging !== undefined}
              actions={sec.actions}
            />
          ) : (
            <ScreenRow
              key={item.row.id}
              row={item.row}
              store={store}
              session={session}
              current={item.row.id === shown}
              state={{
                renaming: nav.renaming === item.row.id,
                sizing: nav.sizing === item.row.id,
                dragging: nav.dragging === item.row.id,
                dropping: nav.dragging !== undefined,
              }}
              registries={registries}
              actions={nav.actions}
            />
          ),
        )}
      </ul>
      <MastersList rows={masters} store={store} session={session} shown={shown} registries={registries} nav={nav} />
      {nav.menu === undefined ? null : (
        <ContextMenu
          items={itemsOf(
            [...rows, ...masters].find((r) => r.id === nav.menu?.id),
            sections,
          )}
          at={{ x: nav.menu.x, y: nav.menu.y }}
          keysOf={NO_KEYS}
          onPick={nav.pick}
          onClose={nav.closeMenu}
        />
      )}
      {sec.menu === undefined ? null : (
        <ContextMenu items={SECTION_ITEMS} at={{ x: sec.menu.x, y: sec.menu.y }} keysOf={NO_KEYS} onPick={sec.pick} onClose={sec.closeMenu} />
      )}
    </>
  );
}
