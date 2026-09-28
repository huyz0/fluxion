// Presentation order of a document's screens (FR-SCR-001, FR-DOC-010): sorted by fractional index,
// id breaking a tie; hidden screens only where the mode policy shows them (edit).
import type { ReadView } from '@fluxion/core';
import { compareKeys, type RecordId } from '@fluxion/schema';

/**
 * The ids of the screens `view` holds, in presentation order; hidden screens are left out unless
 * `showHidden`.
 *
 * @public
 */
export function screensInOrder(view: ReadView, showHidden: boolean): RecordId[] {
  return view
    .members('byType', 'screen')
    .map((id) => ({ id, record: view.get(id) as { index?: unknown; hidden?: unknown } | undefined }))
    .filter(({ record }) => record !== undefined && (showHidden || record.hidden !== true))
    .sort((a, b) => compareKeys(String(a.record?.index ?? ''), String(b.record?.index ?? '')) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(({ id }) => id);
}
