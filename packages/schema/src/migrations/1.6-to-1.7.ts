// 1.6 -> 1.7 (ADR-0047, FR-LAY-014): a layout spec of type `template` names the template (`id`) and the items it was built from (`items`),
// both required, and `id` and `items` are typed on any layout spec. Records are loose, so a 1.6 file may carry a `template` spec without
// them, which the step removes (nothing could build it again), or an `id` or `items` the typed fields refuse, which it removes from the
// spec, rather than make the migrated file invalid.
import type { Migration, RawDocument } from '../migration-types.js';
import { layoutSpecSchema } from '../records/layout-spec.js';

type Fields = { readonly [key: string]: unknown };
const isObject = (v: unknown): v is Fields => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Whether `record` is one that holds a layout spec: a screen, a group or a frame. */
const holdsLayout = (record: Fields): boolean =>
  record['type'] === 'screen' || (record['type'] === 'element' && (record['kind'] === 'group' || record['kind'] === 'frame'));

/** The field of a 1.7 layout spec that `key` names, checked on its own. */
const fieldOk = (key: 'id' | 'items', value: unknown): boolean => layoutSpecSchema.safeParse({ type: 'stack', [key]: value }).success;

/** `record` with a template spec that cannot be built again removed, and an `id` or `items` that does not conform removed from its spec. */
function cleanLayout(record: Fields): Fields {
  const layout = record['layout'];
  if (!isObject(layout)) return record;
  const kept = Object.fromEntries(Object.entries(layout).filter(([k, v]) => (k !== 'id' && k !== 'items') || fieldOk(k, v)));
  if (layout['type'] === 'template' && !('id' in kept && 'items' in kept)) {
    return Object.fromEntries(Object.entries(record).filter(([k]) => k !== 'layout'));
  }
  return Object.keys(kept).length === Object.keys(layout).length ? record : { ...record, layout: kept };
}

/** The step. */
export const migrate16to17: Migration = {
  from: '1.6',
  to: '1.7',
  up: (doc: RawDocument): RawDocument => ({
    ...doc,
    schemaVersion: '1.7',
    records: Object.fromEntries(
      Object.entries(doc.records).map(([id, record]) => [id, isObject(record) && holdsLayout(record) ? cleanLayout(record) : record]),
    ),
  }),
};
