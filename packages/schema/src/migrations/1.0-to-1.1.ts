// 1.0 -> 1.1 (ADR-0021, FR-SCR-004): sections become records. `screen.sectionId` existed in 1.0 but named nothing,
// because no section record could exist; it is dropped so that a 1.1 reader's reference check holds.
import type { Migration, RawDocument } from '../migration-types.js';

/** The step. */
export const migrate10to11: Migration = {
  from: '1.0',
  to: '1.1',
  up: (doc: RawDocument): RawDocument => ({
    ...doc,
    schemaVersion: '1.1',
    records: Object.fromEntries(
      Object.entries(doc.records).map(([id, record]) => {
        if (typeof record !== 'object' || record === null || (record as { type?: unknown }).type !== 'screen') return [id, record];
        const { sectionId: _, ...screen } = record as { readonly [key: string]: unknown };
        return [id, screen];
      }),
    ),
  }),
};
