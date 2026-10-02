// A section's header line in the navigator (FR-SCR-004, M8.15): a fold button with the name and the screen count,
// an inline rename field, and a drop target for a dragged screen. Its menu is the section's own.
import type { RecordId } from '@fluxion/schema';
import type { DragEvent, ReactNode } from 'react';
import type { SectionRow } from './navigator-model.js';
import { RenameField } from './rename-field.js';

/** What a header does. */
export type SectionActions = {
  readonly toggle: (id: RecordId, collapsed: boolean) => void;
  readonly rename: (id: RecordId, name: string) => void;
  readonly startRename: (id: RecordId) => void;
  readonly stopRename: () => void;
  readonly drop: (id: RecordId, e: DragEvent<HTMLLIElement>) => void;
  readonly menu: (id: RecordId, at: { readonly x: number; readonly y: number }) => void;
};

/** Props of {@link SectionHeader}. */
export type SectionHeaderProps = {
  readonly section: SectionRow;
  readonly count: number;
  readonly renaming: boolean;
  /** Whether a screen is being dragged (a drop here moves it into the section). */
  readonly dropping: boolean;
  readonly actions: SectionActions | undefined;
};

/** The header. */
export function SectionHeader(props: SectionHeaderProps): ReactNode {
  const { section: s, count, renaming, dropping, actions } = props;
  return (
    <li
      className="fx-chrome-section"
      data-section-id={s.id}
      data-collapsed={s.collapsed || undefined}
      onDragOver={(e) => {
        if (dropping) e.preventDefault();
      }}
      onDrop={(e) => actions?.drop(s.id, e)}
      onContextMenu={(e) => {
        if (actions === undefined) return;
        e.preventDefault();
        actions.menu(s.id, { x: e.clientX, y: e.clientY });
      }}
    >
      {renaming && actions !== undefined ? (
        <RenameField label={s.name} name={`Rename section ${s.name}`} onCommit={(name) => actions.rename(s.id, name)} onDone={actions.stopRename} />
      ) : (
        <button
          type="button"
          className="fx-chrome-button fx-chrome-section-button"
          aria-expanded={!s.collapsed}
          aria-label={`Section ${s.name}`}
          onClick={() => actions?.toggle(s.id, !s.collapsed)}
          onDoubleClick={() => actions?.startRename(s.id)}
        >
          <span aria-hidden="true">{s.collapsed ? '▸' : '▾'}</span> <span aria-hidden="true">{s.name}</span>{' '}
          <span className="fx-chrome-screen-format" aria-hidden="true">
            {count}
          </span>
        </button>
      )}
    </li>
  );
}
