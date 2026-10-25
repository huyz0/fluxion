import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { writeSha256Length } from './sha256-length.js';

describe('SHA-256 length suffix (NFR-REL-005)', () => {
  it('NFR-REL-005: encodes both length words across the 2^32-bit boundary', () => {
    for (const length of [0, 1, 0x1fffffff, 0x20000000, 0x20000001, 0xffffffff]) {
      const bytes = new Uint8Array(16).fill(0xa5);
      writeSha256Length(new DataView(bytes.buffer), length);
      expect(Array.from(bytes.slice(0, 8))).toEqual(Array(8).fill(0xa5));
      expect(new DataView(bytes.buffer).getBigUint64(8)).toBe(BigInt(length) * 8n);
    }
  });

  it('NFR-REL-005: agrees with integer bit lengths for representable byte arrays', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), (length) => {
        const view = new DataView(new ArrayBuffer(8));
        writeSha256Length(view, length);
        expect(view.getBigUint64(0)).toBe(BigInt(length) * 8n);
      }),
    );
  });
});
