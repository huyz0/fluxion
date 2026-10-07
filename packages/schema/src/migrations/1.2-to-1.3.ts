// 1.2 -> 1.3 (ADR-0031, FR-DSL-005): `screen.layout`, a group's or frame's `layout` and `document.source` arrive. Every new field is
// optional, so a conforming 1.2 file passes through; records are loose, so a 1.2 file may already carry values in those places that the
// typed fields refuse, and the step removes them (as 1.1 -> 1.2 did) rather than make the migrated file invalid.
import type { Migration, RawDocument } from '../migration-types.js';
import { documentRecordSchema } from '../records/document.js';
import { layoutSpecSchema } from '../records/layout-spec.js';

type Fields = { readonly [key: string]: unknown };
const isObject = (v: unknown): v is Fields => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `record` without `key` when its value fails `ok`. */
function keepIf(record: Fields, key: string, ok: (v: unknown) => boolean): Fields {
  if (!(key in record) || ok(record[key])) return record;
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
}

const isLayout = (v: unknown) => layoutSpecSchema.safeParse(v).success;
const isSource = (v: unknown) => documentRecordSchema.safeParse({ id: 'x', type: 'document', source: v }).success;

/** The step. */
export const migrate12to13: Migration = {
  from: '1.2',
  to: '1.3',
  up: (doc: RawDocument): RawDocument => ({
    ...doc,
    schemaVersion: '1.3',
    records: Object.fromEntries(
      Object.entries(doc.records).map(([id, record]) => {
        if (!isObject(record)) return [id, record];
        if (record['type'] === 'document') return [id, keepIf(record, 'source', isSource)];
        if (record['type'] === 'screen') return [id, keepIf(record, 'layout', isLayout)];
        if (record['type'] === 'element' && (record['kind'] === 'group' || record['kind'] === 'frame')) return [id, keepIf(record, 'layout', isLayout)];
        return [id, record];
      }),
    ),
  }),
};
