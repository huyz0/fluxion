// 1.4 -> 1.5 (ADR-0168, FR-CON-007): a connector's `route` gains `tangents` and `jumps`. Both are optional, so a conforming 1.4 file passes through;
// records are loose, so a 1.4 file may already carry a `tangents` or `jumps` the typed fields refuse, and the step removes those (as 1.3 -> 1.4 did)
// rather than make the migrated file invalid.
import type { Migration, RawDocument } from '../migration-types.js';
import { elementKindSchemas } from '../records/element-schemas.js';

type Fields = { readonly [key: string]: unknown };
const isObject = (v: unknown): v is Fields => typeof v === 'object' && v !== null && !Array.isArray(v);

const NEW = ['tangents', 'jumps'] as const;

/** `record` with the new route fields removed when it carries ones the typed schema refuses. */
function cleanConnector(record: Fields): Fields {
  const route = record['route'];
  if (!isObject(route) || !NEW.some((k) => k in route) || elementKindSchemas.connector.safeParse(record).success) return record;
  return { ...record, route: Object.fromEntries(Object.entries(route).filter(([k]) => !(NEW as readonly string[]).includes(k))) };
}

/** The step. */
export const migrate14to15: Migration = {
  from: '1.4',
  to: '1.5',
  up: (doc: RawDocument): RawDocument => ({
    ...doc,
    schemaVersion: '1.5',
    records: Object.fromEntries(
      Object.entries(doc.records).map(([id, record]) => [
        id,
        isObject(record) && record['type'] === 'element' && record['kind'] === 'connector' ? cleanConnector(record) : record,
      ]),
    ),
  }),
};
