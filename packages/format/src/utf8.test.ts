import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeUtf8, encodeUtf8 } from './utf8.js';

// an independent reference: encodeURIComponent's %XX bytes of the text with each lone surrogate made U+FFFD
const LONE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
const encoder = {
  encode: (text: string): Uint8Array =>
    Uint8Array.from(
      [...encodeURIComponent(text.replace(LONE, '\ufffd')).matchAll(/%([0-9A-F]{2})|([^%])/g)].map((m) =>
        m[1] ? Number.parseInt(m[1], 16) : (m[2] as string).charCodeAt(0),
      ),
    ),
};

describe('UTF-8 for the pure packages (FR-LIB-006, NFR-SEC-001)', () => {
  it('FR-LIB-006: encodes every width and replaces lone surrogates with U+FFFD', () => {
    for (const s of [
      '',
      'a',
      'é',
      '€',
      '😀',
      'a😀b',
      '\ud800',
      '\udc00',
      'x\ud800',
      '\ud800𐀀',
      '􏿿',
      '\udc00\udc00',
      '\udc00\ud800',
      '\ud800a',
      'a\ud800',
      '\ud800\ue000',
    ]) {
      expect([...encodeUtf8(s)], JSON.stringify(s)).toEqual([...encoder.encode(s)]);
    }
  });

  it('FR-LIB-006: matches an independent encoder on any UTF-16 string and round-trips well-formed text', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (s) => {
        expect(encodeUtf8(s)).toEqual(encoder.encode(s));
      }),
    );
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme' }), (s) => {
        expect(decodeUtf8(encodeUtf8(s))).toBe(s);
      }),
    );
  });
});
