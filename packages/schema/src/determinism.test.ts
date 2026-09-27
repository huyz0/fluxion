import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { keyBetween, nKeysBetween } from './fractional-index.js';
import { createId, seededRandom } from './ids.js';
import { migrate } from './migrate.js';
import { repair } from './repair.js';
import { parseDocument, serializeDocument } from './serialize.js';
import { arbDocument } from './testing/arbitraries.js';
import { validate } from './validate.js';

/** Every snapshot-style operation of the package on one document, as plain data. */
function snapshot(doc: Parameters<typeof serializeDocument>[0], seed: number): unknown {
  const text = serializeDocument(doc);
  const random = seededRandom(seed);
  const broken = { ...doc, records: { ...doc.records, dangling: { id: 'dangling', type: 'binding', connectorId: 'none', end: 'source' } } };
  return {
    text,
    parsed: parseDocument(text),
    corrupted: parseDocument(text.slice(0, Math.floor(text.length / 2))),
    brokenParse: parseDocument(JSON.stringify(broken)),
    validate: validate(doc),
    repair: repair(doc),
    migrate: migrate(JSON.parse(text)),
    ids: Array.from({ length: 20 }, () => createId(random)),
    keys: [keyBetween(null, null), keyBetween('a0' as never, 'a1' as never), nKeysBetween(null, null, 10)],
  };
}

describe('determinism (NFR-REL-005)', () => {
  it('NFR-REL-005: repeated runs are identical', () => {
    fc.assert(
      fc.property(arbDocument, fc.integer(), (doc, seed) => {
        // twice in one process: no hidden state, randomness or clock reaches the results
        expect(JSON.stringify(snapshot(doc, seed))).toBe(JSON.stringify(snapshot(doc, seed)));
        expect(serializeDocument(doc)).toBe(serializeDocument(doc));
      }),
    );
  });
});
