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
 * The ids of the screens in the order they are presented, which is the order the navigator lists them: the screens in no section first, then each
 * section's screens, sections in their own order and screens in theirs (FR-SCR-004). Hidden screens are left out unless `showHidden`; a screen naming a
 * section that does not exist is in none.
 *
 * @public
 */
export function presentationOrder(view: ReadView, showHidden: boolean): RecordId[] {
  const screens = screensInOrder(view, showHidden);
  const sections = inOrder(view, view.members('byType', 'section'), () => true);
  const known = new Set<RecordId>(sections);
  const sectionOf = (id: RecordId): RecordId | undefined => {
    const section = (view.get(id) as { sectionId?: RecordId } | undefined)?.sectionId;
    return section !== undefined && known.has(section) ? section : undefined;
  };
  return [undefined, ...sections].flatMap((section) => screens.filter((id) => sectionOf(id) === section));
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
