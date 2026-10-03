// 1.1 -> 1.2 (ADR-0152, FR-DOC-006, FR-THM-004): the `document` record gains `description`, `tags` and `custom`, and a
// `screen` gains `themeId`. Records are loose, so a 1.1 file may already carry values in those places that the typed
// fields refuse; the step removes what does not conform (as 1.0 -> 1.1 did for `sectionId`) and passes the rest through.
import type { Migration, RawDocument } from '../migration-types.js';

type Fields = { readonly [key: string]: unknown };
const isObject = (v: unknown): v is Fields => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `fields` without the named keys. */
const without = (fields: Fields, keys: readonly string[]): Fields => Object.fromEntries(Object.entries(fields).filter(([k]) => !keys.includes(k)));

/** The document record with a non-conforming description, tags and custom removed (custom keeps its string entries). */
function metadata(doc: Fields): Fields {
  const drop: string[] = [];
  if ('description' in doc && typeof doc['description'] !== 'string') drop.push('description');
  if ('tags' in doc && !(Array.isArray(doc['tags']) && doc['tags'].every((t) => typeof t === 'string'))) drop.push('tags');
  const kept = without(doc, drop);
  const custom = doc['custom'];
  if (!('custom' in doc)) return kept;
  if (!isObject(custom)) return without(kept, ['custom']);
  return { ...kept, custom: Object.fromEntries(Object.entries(custom).filter(([, v]) => typeof v === 'string')) };
}

/** The step. */
export const migrate11to12: Migration = {
  from: '1.1',
  to: '1.2',
  up: (doc: RawDocument): RawDocument => {
    const themes = new Set(
      Object.entries(doc.records)
        .filter(([, r]) => isObject(r) && r['type'] === 'theme')
        .map(([id]) => id),
    );
    return {
      ...doc,
      schemaVersion: '1.2',
      records: Object.fromEntries(
        Object.entries(doc.records).map(([id, record]) => {
          if (!isObject(record)) return [id, record];
          if (record['type'] === 'document') return [id, metadata(record)];
          if (record['type'] === 'screen' && 'themeId' in record) {
            const named = record['themeId'];
            return [id, typeof named === 'string' && themes.has(named) ? record : without(record, ['themeId'])];
          }
          return [id, record];
        }),
      ),
    };
  },
};
