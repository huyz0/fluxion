// Presentation order (FR-SCR-001, FR-DOC-010): screens, and the elements of one parent, sorted by
// fractional index with the id breaking a tie. Hidden screens only where the mode policy shows them
// (edit); hidden elements are never drawn (the editor's ghosts are overlay, 04 §2.6).
import type { ReadView } from '@fluxion/core';
import { compareKeys, type RecordId } from '@fluxion/schema';

type Ordered = { readonly index?: unknown; readonly hidden?: unknown; readonly parentId?: unknown };

function inOrder(view: ReadView, ids: readonly RecordId[], keep: (record: Ordered) => boolean): RecordId[] {
  return ids
    .map((id) => ({ id, record: view.get(id) as Ordered | undefined }))
    .filter((e): e is { id: RecordId; record: Ordered } => e.record !== undefined && keep(e.record))
    .sort((a, b) => compareKeys(String(a.record.index ?? ''), String(b.record.index ?? '')) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(({ id }) => id);
}

/**
 * The ids of the screens `view` holds, in presentation order; hidden screens are left out unless
 * `showHidden`.
 *
 * @public
 */
export function screensInOrder(view: ReadView, showHidden: boolean): RecordId[] {
  return inOrder(view, view.members('byType', 'screen'), (r) => showHidden || r.hidden !== true);
}

/**
 * The ids of the visible elements directly under `parentId` (a group or frame), or at the root of
 * `screenId` when `parentId` is absent, back to front.
 *
 * @public
 */
export function elementsInOrder(view: ReadView, screenId: RecordId, parentId?: RecordId): RecordId[] {
  const ids = parentId === undefined ? view.members('byScreen', screenId) : view.members('byParent', parentId);
  return inOrder(view, ids, (r) => r.hidden !== true && (parentId !== undefined || r.parentId === undefined));
}
