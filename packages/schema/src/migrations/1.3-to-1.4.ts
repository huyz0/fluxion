// 1.3 -> 1.4 (ADR-0043, FR-ANC-003): an `AnchorDef` gains `kind`, `side` and `t`, and `x`/`y` are only required for a fixed anchor. Every new
// field is optional, so a conforming 1.3 file passes through; records are loose, so a 1.3 file may already carry a `kind`, `side` or `t` the
// typed fields refuse, and the step removes those (as 1.2 -> 1.3 did) rather than make the migrated file invalid.
import type { Migration, RawDocument } from '../migration-types.js';
import { anchorDefSchema } from '../records/element-schemas.js';

type Fields = { readonly [key: string]: unknown };
const isObject = (v: unknown): v is Fields => typeof v === 'object' && v !== null && !Array.isArray(v);

const NEW = ['kind', 'side', 't'] as const;

/** `def` without the new fields it carries that the typed schema refuses (when that is what makes it invalid). */
function cleanAnchor(def: unknown): unknown {
  if (!isObject(def) || anchorDefSchema.safeParse(def).success) return def;
  const kept = Object.fromEntries(Object.entries(def).filter(([k]) => !(NEW as readonly string[]).includes(k)));
  return kept;
}

/** The step. */
export const migrate13to14: Migration = {
  from: '1.3',
  to: '1.4',
  up: (doc: RawDocument): RawDocument => ({
    ...doc,
    schemaVersion: '1.4',
    records: Object.fromEntries(
      Object.entries(doc.records).map(([id, record]) => {
        if (!isObject(record) || record['type'] !== 'element' || !Array.isArray(record['anchors'])) return [id, record];
        return [id, { ...record, anchors: record['anchors'].map(cleanAnchor) }];
      }),
    ),
  }),
};
