// 1.5 -> 1.6 (ADR-0046, FR-LAY-010): a layout spec gains `live`. It is optional, so a conforming 1.5 file passes through; records are loose,
// so a 1.5 file may already carry a `live` that is not a boolean on a screen's, a group's or a frame's `layout`, and the step removes it
// (as 1.4 -> 1.5 did) rather than make the migrated file invalid.
import type { Migration, RawDocument } from '../migration-types.js';

type Fields = { readonly [key: string]: unknown };
const isObject = (v: unknown): v is Fields => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Whether `record` is one that holds a layout spec: a screen, a group or a frame. */
const holdsLayout = (record: Fields): boolean =>
  record['type'] === 'screen' || (record['type'] === 'element' && (record['kind'] === 'group' || record['kind'] === 'frame'));

/** `record` with its layout's `live` removed when that is not a boolean. */
function cleanLayout(record: Fields): Fields {
  const layout = record['layout'];
  if (!isObject(layout) || !('live' in layout) || typeof layout['live'] === 'boolean') return record;
  return { ...record, layout: Object.fromEntries(Object.entries(layout).filter(([k]) => k !== 'live')) };
}

/** The step. */
export const migrate15to16: Migration = {
  from: '1.5',
  to: '1.6',
  up: (doc: RawDocument): RawDocument => ({
    ...doc,
    schemaVersion: '1.6',
    records: Object.fromEntries(
      Object.entries(doc.records).map(([id, record]) => [id, isObject(record) && holdsLayout(record) ? cleanLayout(record) : record]),
    ),
  }),
};
