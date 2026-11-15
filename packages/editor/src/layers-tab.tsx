// The Layers tab (FR-ARR-008, M19.14): the shown screen's elements as a tree, front first, members indented under their group or
// frame. A click selects (Shift adds or removes), a drag among siblings reorders (one `element.reorder`: only the moved record's
// index changes), Alt+ArrowUp/ArrowDown steps the row's element forward or back, and each row's toggles hide it or lock it. Every
// change is one command, so one undo step.
import type { Store } from '@fluxion/core';
import { useValue } from '@fluxion/render';
import type { RecordId } from '@fluxion/schema';
import { t } from '@lingui/core/macro';
import './i18n.js';
import { type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode, useMemo, useState } from 'react';
import { type LayerRow, layerDrop, layerRows, toggledLocks } from './layers-model.js';
import type { Execute } from './pointer.js';
import type { Session } from './session.js';

/**
 * Props of {@link LayersTab}.
 *
 * @public
 */
export type LayersTabProps = {
  /** The document store. */
  readonly store: Store;
  /** The session whose selection it shows and sets. */
  readonly session: Session;
  /** Runs the commands. */
  readonly execute: Execute;
  /** The screen the canvas shows; no rows without one. */
  readonly screenId: RecordId | undefined;
};

/** What a row does. */
type RowActions = {
  readonly select: (row: LayerRow, e: MouseEvent) => void;
  readonly step: (row: LayerRow, e: KeyboardEvent) => void;
  readonly hide: (row: LayerRow) => void;
  readonly lock: (row: LayerRow) => void;
  readonly dragStart: (row: LayerRow, e: DragEvent) => void;
  readonly dragEnd: () => void;
  readonly drop: (row: LayerRow, e: DragEvent<HTMLLIElement>) => void;
};

/** One layer: its select button and its hide and lock toggles; draggable, and the target of drops. */
function LayerItem(props: { readonly row: LayerRow; readonly selected: boolean; readonly dragging: boolean; readonly actions: RowActions }): ReactNode {
  const { row, selected, dragging, actions } = props;
  return (
    <li
      className="fx-chrome-layer"
      data-layer-id={row.id}
      data-hidden={row.hidden || undefined}
      data-locked={row.locked || undefined}
      data-dragging={dragging || undefined}
      style={{ paddingInlineStart: `${row.depth * 12}px` }}
      draggable
      onDragStart={(e) => actions.dragStart(row, e)}
      onDragEnd={actions.dragEnd}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => actions.drop(row, e)}
    >
      <button
        type="button"
        className="fx-chrome-button fx-chrome-layer-button"
        aria-pressed={selected}
        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
        onClick={(e) => actions.select(row, e)}
        onKeyDown={(e) => actions.step(row, e)}
      >
        {row.label}
      </button>
      <button type="button" className="fx-chrome-button" aria-pressed={row.hidden} aria-label={t`Hide ${row.label}`} onClick={() => actions.hide(row)}>
        {row.hidden ? t`Hidden` : t`Hide`}
      </button>
      <button type="button" className="fx-chrome-button" aria-pressed={row.locked} aria-label={t`Lock ${row.label}`} onClick={() => actions.lock(row)}>
        {row.locked ? t`Locked` : t`Lock`}
      </button>
    </li>
  );
}

/** The row actions over `rows`, each command sealed as its own undo step. */
function useActions(
  props: LayersTabProps,
  rows: readonly LayerRow[],
  dragging: RecordId | undefined,
  setDragging: (id: RecordId | undefined) => void,
): RowActions {
  const { store, session, execute } = props;
  return useMemo((): RowActions => {
    const run = (id: string, args: unknown): void => {
      if (execute(id, args).ok) store.history.seal();
    };
    const locksOf = (id: RecordId) => (store.get(id) as { locks?: Record<string, unknown> } | undefined)?.locks;
    return {
      select: (row, e) => {
        const now = session.selection.get();
        if (!e.shiftKey) session.selection.set([row.id]);
        else session.selection.set(now.includes(row.id) ? now.filter((x) => x !== row.id) : [...now, row.id]);
      },
      step: (row, e) => {
        if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        e.preventDefault();
        run('element.zOrder', { ids: [row.id], to: e.key === 'ArrowUp' ? 'forward' : 'backward' });
      },
      hide: (row) => run('element.update', { id: row.id, fields: { hidden: row.hidden ? undefined : true } }),
      lock: (row) => run('element.update', { id: row.id, fields: { locks: toggledLocks(locksOf(row.id), !row.locked) } }),
      dragStart: (row, e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', row.id);
        setDragging(row.id);
      },
      dragEnd: () => setDragging(undefined),
      drop: (row, e) => {
        e.preventDefault();
        setDragging(undefined);
        if (dragging === undefined) return;
        const box = e.currentTarget.getBoundingClientRect();
        const move = layerDrop(rows, dragging, row.id, e.clientY < box.top + box.height / 2);
        if (move !== null) run('element.reorder', move);
      },
    };
  }, [store, session, execute, rows, dragging, setDragging]);
}

/**
 * The layers of the shown screen.
 *
 * @public
 */
export function LayersTab(props: LayersTabProps): ReactNode {
  const { store, session, screenId } = props;
  const rows = useValue(useMemo(() => store.query((view) => (screenId === undefined ? [] : layerRows(view, screenId))), [store, screenId]));
  const selection = useValue(session.selection.get);
  const [dragging, setDragging] = useState<RecordId | undefined>(undefined);
  const actions = useActions(props, rows, dragging, setDragging);
  if (rows.length === 0) return <p className="fx-chrome-placeholder">{t`This screen has no elements yet.`}</p>;
  return (
    <ul className="fx-chrome-layers" aria-label={t`Layers`}>
      {rows.map((row) => (
        <LayerItem key={row.id} row={row} selected={selection.includes(row.id)} dragging={dragging === row.id} actions={actions} />
      ))}
    </ul>
  );
}
