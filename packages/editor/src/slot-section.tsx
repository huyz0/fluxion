// The inspector's icon slots section (FR-SHP-007, M19.17): each slot of a selected shape by name, with the shape definition
// filling it typed in (Enter or leaving commits, Escape gives it back, blank empties it); an image fill is named, not typed over.
import type { Store } from '@fluxion/core';
import { useValue } from '@fluxion/render';
import type { RecordId } from '@fluxion/schema';
import { t } from '@lingui/core/macro';
import './i18n.js';
import { type ReactNode, useMemo } from 'react';
import { commitKeys } from './inspector-keys.js';
import type { ShapeDefs } from './param-handles.js';
import type { Execute } from './pointer.js';
import { fillSlot, slotRows } from './slot-inspector.js';

/** A selected shape's icon slots; nothing when its definition has none. Each change is one undo step. */
export function IconSlotsSection(props: {
  readonly store: Store;
  readonly id: RecordId;
  readonly execute: Execute;
  readonly shapeDefs: ShapeDefs | undefined;
}): ReactNode {
  const { store, id, execute, shapeDefs } = props;
  const rows = useValue(useMemo(() => store.query((view) => slotRows(view, id, shapeDefs)), [store, id, shapeDefs]));
  if (rows === undefined) return null;
  const fill = (name: string, defId: string): boolean => {
    const c = fillSlot(store, id, name, defId);
    const ok = c === undefined || execute(c.id, c.args).ok;
    store.history.seal();
    return ok;
  };
  return (
    <fieldset className="fx-chrome-group" data-icon-slots="">
      <legend className="fx-chrome-heading">{t`Icons`}</legend>
      {rows.map((row) => {
        const text = row.defId ?? '';
        return (
          <div key={`${row.name}:${text}`} className="fx-chrome-field" data-slot-row={row.name}>
            <span className="fx-chrome-field-label">{row.name}</span>
            {row.assetId === undefined ? (
              <input
                className="fx-chrome-input"
                type="text"
                aria-label={t`Icon shape for ${row.name}`}
                defaultValue={text}
                onKeyDown={(e) => commitKeys(e, text)}
                onBlur={(e) => {
                  const typed = e.currentTarget.value.trim();
                  if (typed !== text && !fill(row.name, typed)) e.currentTarget.value = text;
                }}
              />
            ) : (
              <span>{t`Image`}</span>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}
