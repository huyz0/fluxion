// A new, empty document (FR-EDT-001): the document record and one 16:9 screen (1920 x 1080),
// its ids drawn from the injected `Random` (the host passes a crypto source; tests a seeded one).
import { createId, type DocumentFile, type IndexKey, keyBetween, type Ok, type Random, SCHEMA_VERSION } from '@fluxion/schema';

/** The size of a new document's first screen, px: 16:9. */
const FIRST_SCREEN = { w: 1920, h: 1080 };

/**
 * A new document with one empty 16:9 screen, its ids from `random`.
 *
 * @public
 */
export function newDocument(random: Random): DocumentFile {
  const docId = createId(random);
  const screenId = createId(random);
  // the key between nothing and nothing always exists
  const index = keyBetween(null, null) as Ok<IndexKey>;
  return {
    schemaVersion: SCHEMA_VERSION,
    records: {
      [docId]: { id: docId, type: 'document' },
      [screenId]: { id: screenId, type: 'screen', index: index.value, name: 'Screen 1', size: FIRST_SCREEN },
    },
  };
}
