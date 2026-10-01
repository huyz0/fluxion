// Which elements have text the editor opens (FR-TXT-003, M7.12) and the one write that closes the edit.
// A shape's text and a `text` element's are the same rich text; the editor opens both (a `text` element
// that was pasted, imported or written by hand draws through TextView and edits in the same editor).
import type { ReadView } from '@fluxion/core';
import type { ElementRecord, RecordId, ShapeElement, TextElement } from '@fluxion/schema';
import type { Session } from './session.js';

/** The element kinds whose text the editor edits (a registry, not a chain of tests: FR-EXT-001). */
const TEXTED: ReadonlySet<unknown> = new Set(['shape', 'text']);

/** The element `id`, when it is one whose text the editor can edit. */
export function textElement(view: ReadView, id: RecordId): ShapeElement | TextElement | undefined {
  const record = view.get(id) as ElementRecord | undefined;
  return record?.type === 'element' && TEXTED.has(record.kind) ? (record as ShapeElement | TextElement) : undefined;
}

/** Whether the record `id` is an element whose text the editor can edit. */
export const hasText = (view: ReadView, id: RecordId): boolean => textElement(view, id) !== undefined;

/** Open the text of the one selected element for editing; false when the selection is not exactly one such element. */
export function editSelectedText(session: Session, view: ReadView): boolean {
  const [only, ...rest] = session.selection.get();
  if (only === undefined || rest.length > 0 || !hasText(view, only)) return false;
  session.editing.set(only);
  return true;
}
