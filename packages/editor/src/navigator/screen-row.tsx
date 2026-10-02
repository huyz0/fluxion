// One row of the navigator (FR-SCR-002, M8.12): the screen's button with its thumbnail, or its rename field, and the
// hide toggle; draggable, and the target of drops and of the screen menu.
import type { Store } from '@fluxion/core';
import type { RenderRegistries } from '@fluxion/render';
import type { RecordId } from '@fluxion/schema';
import type { DragEvent, ReactNode } from 'react';
import { switchScreen } from '../screen-switch.js';
import type { Session } from '../session.js';
import { parseSize, type Row } from './navigator-model.js';
import { RenameField } from './rename-field.js';
import { Thumbnail } from './thumbnail.js';

export type { Row } from './navigator-model.js';

/** What a row does; present when the navigator can edit. */
export type RowActions = {
  readonly rename: (id: RecordId, name: string) => void;
  readonly setHidden: (id: RecordId, hidden: boolean) => void;
  readonly startRename: (id: RecordId) => void;
  readonly stopRename: () => void;
  readonly setSize: (id: RecordId, size: { readonly w: number; readonly h: number }) => void;
  readonly dragStart: (id: RecordId, e: DragEvent<HTMLLIElement>) => void;
  readonly dragEnd: () => void;
  readonly drop: (id: RecordId, e: DragEvent<HTMLLIElement>) => void;
  readonly menu: (id: RecordId, at: { readonly x: number; readonly y: number }) => void;
};

/** Props of {@link ScreenRow}. */
export type ScreenRowProps = {
  readonly row: Row;
  readonly store: Store;
  readonly session: Session;
  /** Whether the canvas shows this screen. */
  readonly current: boolean;
  /** Whether the row is being renamed, or dragged. */
  readonly state: { readonly renaming: boolean; readonly sizing: boolean; readonly dragging: boolean; readonly dropping: boolean };
  readonly registries: RenderRegistries | undefined;
  readonly actions: RowActions | undefined;
};

/** What the row shows in the screen's place: its size field, its rename field, or its button. */
function RowBody(props: ScreenRowProps): ReactNode {
  const { row: r, store, session, current, state, registries, actions } = props;
  return (
    <>
      {state.sizing && actions !== undefined ? (
        <RenameField
          label={`${r.size.w}x${r.size.h}`}
          name={`Size of ${r.label}`}
          accepts={(text) => parseSize(text) !== undefined}
          onCommit={(text) => {
            const size = parseSize(text);
            if (size !== undefined) actions.setSize(r.id, size);
          }}
          onDone={actions.stopRename}
        />
      ) : state.renaming && actions !== undefined ? (
        <RenameField label={r.label} onCommit={(name) => actions.rename(r.id, name)} onDone={actions.stopRename} />
      ) : (
        <button
          type="button"
          className="fx-chrome-button fx-chrome-screen-button"
          aria-pressed={current}
          onClick={() => switchScreen(session, r.id)}
          onDoubleClick={() => actions?.startRename(r.id)}
        >
          {registries === undefined ? null : <Thumbnail store={store} registries={registries} screenId={r.id} />}
          <span>{r.label}</span>
          <span className="fx-chrome-screen-format" aria-hidden="true">
            {r.format}
          </span>
        </button>
      )}
    </>
  );
}

/** The row. */
export function ScreenRow(props: ScreenRowProps): ReactNode {
  const { row: r, store, session, current, state, registries, actions } = props;
  return (
    <li
      className="fx-chrome-screen"
      data-screen-id={r.id}
      data-hidden={r.hidden || undefined}
      data-format={r.format}
      data-dragging={state.dragging || undefined}
      draggable={actions !== undefined && !state.renaming && !state.sizing}
      onDragStart={(e) => actions?.dragStart(r.id, e)}
      onDragEnd={() => actions?.dragEnd()}
      onDragOver={(e) => {
        if (state.dropping) e.preventDefault();
      }}
      onDrop={(e) => actions?.drop(r.id, e)}
      onContextMenu={(e) => {
        if (actions === undefined) return;
        e.preventDefault();
        actions.menu(r.id, { x: e.clientX, y: e.clientY });
      }}
    >
      <RowBody {...props} />
      {actions === undefined ? null : (
        <button
          type="button"
          className="fx-chrome-button fx-chrome-screen-hide"
          aria-pressed={r.hidden}
          aria-label={`Hide ${r.label} from presentation`}
          title={r.hidden ? 'Hidden from presentation' : 'Hide from presentation'}
          onClick={() => actions.setHidden(r.id, !r.hidden)}
        >
          {r.hidden ? 'Hidden' : 'Hide'}
        </button>
      )}
    </li>
  );
}
