// The table cell text editor (FR-SHP-014, M19.43): the rich text of the cell in `session.editingCell`, edited in place by the inline
// text editor's ProseMirror view, laid over the cell where its text is drawn (the same box, padding and font, through the camera and
// the table's turn). Esc or focus leaving commits, one `element.update` of the table's cells and one undo step; Tab and Shift+Tab
// commit and open the next or previous cell in reading order, skipping the cells a merged one covers (past the last, Tab leaves the
// editor). Opening a cell (a double-click, Enter with one picked) is table-edit.ts's `openCell`, refused on a locked table.
import { lockedWithin, type Store, stepCell } from '@fluxion/core';
import { tableCellLabel, useValue } from '@fluxion/render';
import { LIGHT_THEME } from '@fluxion/theme';
import { t } from '@lingui/core/macro';
import './i18n.js';
import { type ReactNode, useEffect, useMemo, useRef } from 'react';
import { InPlaceFrame, openInPlace } from './inline-text-editor.js';
import { placements } from './overlay-geometry.js';
import type { Execute } from './pointer.js';
import type { Session, TableCellAt } from './session.js';
import { cellBox, openCell, tableOf } from './table-edit.js';

/** Props of {@link TableCellEditor}. */
export type TableCellEditorProps = {
  /** The document store. */
  readonly store: Store;
  /** The session: the cell being edited, and the camera it is drawn through. */
  readonly session: Session;
  /** Runs a command. */
  readonly execute: Execute;
};

/**
 * The editor over the table cell being edited, mounted only while one is.
 *
 * @public
 */
export function TableCellEditor(props: TableCellEditorProps): ReactNode {
  const at = useValue(props.session.editingCell.get);
  return at === undefined ? null : <EditingCell key={`${at.id}/${at.row}:${at.col}`} {...props} at={at} />;
}

/** Open the editor in `parent` on the cell `at`; returns what closes it, which writes what was typed to that cell alone. */
function openEditor(parent: HTMLElement, ctx: TableCellEditorProps & { readonly at: TableCellAt }): () => void {
  const { store, session, execute, at } = ctx;
  const key = `${at.row}:${at.col}`;
  const [row, col] = [at.row + 1, at.col + 1];
  return openInPlace(parent, {
    text: tableOf(store, at.id)?.cells[key]?.text,
    name: t`Cell text, row ${row}, column ${col}`,
    closed: () => session.editingCell.set(undefined),
    write: (text) => {
      const table = tableOf(store, at.id);
      if (table === undefined || lockedWithin(store, at.id, 'edit')) return;
      execute('element.update', { id: at.id, fields: { cells: { ...table.cells, [key]: { ...table.cells[key], text } } } });
      store.history.seal();
    },
    next: (back) => {
      const table = tableOf(store, at.id);
      const to = table === undefined ? undefined : stepCell(table, at.row, at.col, back ? -1 : 1);
      return to === undefined ? false : () => openCell(session, store, { id: at.id, ...to });
    },
  });
}

/** The open editor of the cell `at`. */
function EditingCell(props: TableCellEditorProps & { readonly at: TableCellAt }): ReactNode {
  const { store, session, execute, at } = props;
  const host = useRef<HTMLDivElement>(null);
  const camera = useValue(session.camera.get);
  const table = useValue(useMemo(() => store.query((view) => tableOf(view, at.id)), [store, at.id]));
  const placed = useValue(useMemo(() => store.query((view) => placements(view, [at.id])[0]), [store, at.id]));
  const box = table === undefined ? undefined : cellBox(table, at.row, at.col);
  const gone = box === undefined;
  // the table or the cell went (an undo, a delete or a merge elsewhere): nothing left to write to
  useEffect(() => {
    if (gone) session.editingCell.set(undefined);
  }, [gone, session]);
  useEffect(() => (host.current === null ? undefined : openEditor(host.current, { store, session, execute, at })), [store, session, execute, at]);
  if (table === undefined || box === undefined || placed === undefined) return null;
  const label = tableCellLabel(table, at.row, table.cells[box.key]?.style, LIGHT_THEME);
  const hide = `.fx-el[data-el-id="${CSS.escape(at.id)}"] .fx-table-cell[data-cell="${box.key}"] > .fx-label`;
  return (
    <InPlaceFrame testId="cell-editor" camera={camera} placed={placed} hide={hide}>
      <div
        ref={host}
        className="fx-label"
        style={{ ...label, position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, boxSizing: 'border-box' }}
      />
    </InPlaceFrame>
  );
}
