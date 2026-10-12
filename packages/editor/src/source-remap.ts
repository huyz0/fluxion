// The session follows an apply of the source view that changed ids (FR-EDT-022, ADR-0032: "a renamed slug maps its old id to the new one"): what was
// selected, hovered, edited or entered, and the screen shown, keep pointing at the same element or screen under its new id. Never part of the document.
import type { RecordId } from '@fluxion/schema';
import type { Session } from './session.js';

/** Move `session` from the old ids of `remap` to the new ones. */
export function followRemap(session: Session, remap: ReadonlyMap<RecordId, RecordId>): void {
  const selected = session.selection.get();
  if (selected.some((id) => remap.has(id))) session.selection.set(selected.map((id) => remap.get(id) ?? id));
  for (const signal of [session.hover, session.editing, session.entered, session.screen]) {
    const at = signal.get();
    const to = at === undefined ? undefined : remap.get(at);
    if (to !== undefined) signal.set(to);
  }
}
