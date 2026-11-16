// The inspector's icon slots section (FR-SHP-007, M19.17): each slot of a selected shape by name, with the shape definition
// filling it typed in (Enter or leaving commits, Escape gives it back, blank empties it); an image fill is named, not typed over.
import type { Store } from '@fluxion/core';
import { useValue } from '@fluxion/render';
import type { RecordId } from '@fluxion/schema';
import { t } from '@lingui/core/macro';
import './i18n.js';
import { type ReactNode, useMemo, useRef } from 'react';
import { commitKeys } from './inspector-keys.js';
import type { ShapeDefs } from './param-handles.js';
import type { Execute } from './pointer.js';
import { fillSlot, slotRows } from './slot-inspector.js';

/** Load `defId` through `ensure` when it is not registered yet; whatever the outcome, the slot is filled after (an unknown id is reported). */
async function loadFirst(defId: string, ensure: ((defId: string) => Promise<boolean>) | undefined, defs: ShapeDefs | undefined): Promise<void> {
  if (defId === '' || ensure === undefined || defs?.get(defId) !== undefined) return;
  await ensure(defId).catch(() => false);
}

/** A selected shape's icon slots; nothing when its definition has none. Each change is one undo step. */
export function IconSlotsSection(props: {
  readonly store: Store;
  readonly id: RecordId;
  readonly execute: Execute;
  readonly shapeDefs: ShapeDefs | undefined;
  /** Loads and registers a definition the host's catalog has (a first-party pack's, M19.38) before a slot names it. */
  readonly ensureDef?: ((defId: string) => Promise<boolean>) | undefined;
}): ReactNode {
  const { store, id, execute, shapeDefs, ensureDef } = props;
  const rows = useValue(useMemo(() => store.query((view) => slotRows(view, id, shapeDefs)), [store, id, shapeDefs]));
  // the latest commit of each shape's slot: a commit whose load ends after a later one of the same slot was made is dropped
  // (M19.38 r1 F3); keyed by shape too, since the section stays mounted while the selection moves (r2)
  const latest = useRef(new Map<string, number>());
  const turn = useRef(0);
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
                  const input = e.currentTarget;
                  const typed = input.value.trim();
                  if (typed === text) return;
                  // a definition the catalog has is loaded first, so the slot draws it and the save embeds it (M19.38)
                  turn.current += 1;
                  const mine = turn.current;
                  const slot = `${id}:${row.name}`;
                  latest.current.set(slot, mine);
                  void loadFirst(typed, ensureDef, shapeDefs).then(() => {
                    if (latest.current.get(slot) !== mine) return;
                    if (!fill(row.name, typed)) input.value = text;
                  });
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
