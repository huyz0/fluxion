// The inspector's anchors section (FR-ANC-006, FR-ANC-005): a selected shape's anchors by name, its custom ones with their place and a
// remove button, and an add button; the model and commands are anchor-inspector.ts.
import type { Store } from '@fluxion/core';
import { useValue } from '@fluxion/render';
import type { RecordId } from '@fluxion/schema';
import { t } from '@lingui/core/macro';
import './i18n.js';
import { type ReactNode, useMemo } from 'react';
import { type AnchorRow, addAnchor, anchorRows, moveAnchor, removeAnchor } from './anchor-inspector.js';
import { commitKeys } from './inspector-keys.js';
import type { InspectorCommand } from './inspector-model.js';
import type { ShapeDefs } from './param-handles.js';
import type { Execute } from './pointer.js';

/**
 * A selected shape's anchors (FR-ANC-006, FR-ANC-005): each by name, its custom ones with their place across and down the box (0 to 1)
 * and a button to remove them, and a button to add one. Each change is one undo step.
 */
export function AnchorsSection(props: {
  readonly store: Store;
  readonly id: RecordId;
  readonly execute: Execute;
  readonly shapeDefs: ShapeDefs | undefined;
}): ReactNode {
  const { store, id, execute, shapeDefs } = props;
  const rows = useValue(useMemo(() => store.query((view) => anchorRows(view, id, shapeDefs)), [store, id, shapeDefs]));
  if (rows === undefined) return null;
  const run = (c: InspectorCommand | undefined): boolean => {
    const ok = c === undefined || execute(c.id, c.args).ok;
    store.history.seal();
    return ok;
  };
  return (
    <fieldset className="fx-chrome-group" data-anchors="">
      <legend className="fx-chrome-heading">{t`Anchors`}</legend>
      {rows.map((row) => (
        <AnchorRowView key={row.name} row={row} move={(to) => run(moveAnchor(store, id, row.name, to))} remove={() => run(removeAnchor(store, id, row.name))} />
      ))}
      <button type="button" className="fx-chrome-button" onClick={() => run(addAnchor(store, id, shapeDefs)?.command)}>
        {t`Add anchor`}
      </button>
    </fieldset>
  );
}

/** One anchor: its name; a custom one also its place, typed (Enter or leaving commits, Escape gives it back), and a remove button. */
function AnchorRowView(props: {
  readonly row: AnchorRow;
  readonly move: (to: { readonly x?: number; readonly y?: number }) => boolean;
  readonly remove: () => void;
}): ReactNode {
  const { row, move, remove } = props;
  const place = (axis: 'x' | 'y') => {
    const value = row[axis];
    const text = value === undefined ? '' : String(value);
    return (
      <input
        key={`${axis}:${text}`}
        className="fx-chrome-input"
        type="text"
        inputMode="decimal"
        aria-label={axis === 'x' ? t`Anchor ${row.name} across` : t`Anchor ${row.name} down`}
        defaultValue={text}
        onKeyDown={(e) => commitKeys(e, text)}
        onBlur={(e) => {
          const typed = e.currentTarget.value.trim();
          const n = Number(typed);
          if (typed === text) return;
          if (typed === '' || !Number.isFinite(n) || !move({ [axis]: n })) e.currentTarget.value = text;
          // the place is kept within the box: the box shows where it went (past 1 at 1 already changes nothing and remounts nothing)
          else e.currentTarget.value = String(Math.min(1, Math.max(0, n)));
        }}
      />
    );
  };
  return (
    <div className="fx-chrome-field" data-anchor-row={row.name} data-custom={row.custom || undefined}>
      <span className="fx-chrome-field-label">{row.name}</span>
      {row.x !== undefined || row.y !== undefined ? (
        <span className="fx-chrome-choices">
          {place('x')}
          {place('y')}
        </span>
      ) : (
        <span />
      )}
      {row.custom ? (
        <button type="button" className="fx-chrome-button" aria-label={t`Remove anchor ${row.name}`} onClick={remove}>
          ×
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}
