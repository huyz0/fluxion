import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createId, ID_ALPHABET, isGeneratedId, isRecordId, seededRandom } from './ids.js';

describe('record ids', () => {
  it('FR-DOC-002: 1e6 ids have no collision', () => {
    const random = seededRandom(20_260_927);
    const seen = new Set<string>();
    for (let i = 0; i < 1_000_000; i++) seen.add(createId(random));
    expect(seen.size).toBe(1_000_000);
    // ~0.6 s idle; the pre-commit ladder runs it under coverage beside other steps on small CI runners
  }, 60_000);

  it('FR-DOC-002: every id is 16 URL-safe characters', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const id = createId(seededRandom(seed));
        expect(id).toMatch(/^[A-Za-z0-9_-]{16}$/);
        expect(isGeneratedId(id)).toBe(true);
        expect(isRecordId(id)).toBe(true);
      }),
    );
  });

  it('NFR-REL-005: the same seed yields the same ids', () => {
    const a = seededRandom(7);
    const b = seededRandom(7);
    const ids = (r: typeof a) => Array.from({ length: 50 }, () => createId(r));
    expect(ids(a)).toEqual(ids(b));
    expect(createId(seededRandom(8))).not.toBe(createId(seededRandom(7)));
  });

  it('uses the whole alphabet and clamps an out-of-range port', () => {
    const r = seededRandom(1);
    const used = new Set(Array.from({ length: 2000 }, () => createId(r)).join(''));
    expect(used.size).toBe(ID_ALPHABET.length);
    expect(createId({ next: () => 1 })).toBe('-'.repeat(16));
    expect(createId({ next: () => -0.5 })).toBe('A'.repeat(16));
  });

  it('seededRandom stays in [0, 1)', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const r = seededRandom(seed);
        for (let i = 0; i < 20; i++) {
          const x = r.next();
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThan(1);
        }
      }),
    );
  });

  it('accepts readable fixture ids and rejects others', () => {
    expect(isRecordId('doc')).toBe(true);
    expect(isRecordId('s1')).toBe(true);
    expect(isRecordId('')).toBe(false);
    expect(isRecordId('a b')).toBe(false);
    expect(isRecordId('x'.repeat(65))).toBe(false);
    expect(isRecordId(42)).toBe(false);
    expect(isGeneratedId('doc')).toBe(false);
  });
});
