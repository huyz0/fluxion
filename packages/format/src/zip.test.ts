import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { crc32 } from './crc32.js';
import { deflateRaw } from './deflate.js';
import { inflateRaw } from './inflate.js';
import { decodeUtf8, encodeUtf8 } from './utf8.js';
import { readZip, writeZip } from './zip.js';

declare global {
  interface ImportMeta {
    /** Vite's build-time glob import. */
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}

// reference streams written by zlib (Python 3): a zip with a dynamic-Huffman entry, a stored one and an empty one; a fixed-Huffman stream; a stored one
const FIXTURES = import.meta.glob('../__fixtures__/zip/*.b64', { query: '?raw', import: 'default', eager: true });
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** The bytes of base64 text (this package's `lib` has no `atob`). */
const fromBase64 = (b64: string): Uint8Array => {
  const out: number[] = [];
  let bits = 0;
  let count = 0;
  for (const ch of b64.replace(/=+$/, '')) {
    bits = (bits << 6) | ALPHABET.indexOf(ch);
    count += 6;
    if (count >= 8) {
      count -= 8;
      out.push((bits >> count) & 0xff);
      bits &= (1 << count) - 1;
    }
  }
  return Uint8Array.from(out);
};
const fixture = (name: string): Uint8Array => {
  const text = Object.entries(FIXTURES).find(([path]) => path.endsWith(name))?.[1];
  if (text === undefined) throw new Error(`no fixture ${name}`);
  return fromBase64(text.trim());
};
/** The text the fixtures were made from (the same generator as the Python that wrote them). */
const sample = (n: number): Uint8Array =>
  encodeUtf8(Array.from({ length: n }, (_, i) => `{"id":"e${i}","x":${(i * 37) % 1000},"y":${(i * 91) % 700},"label":"Node ${i} — ünïcode ✓"}\n`).join(''));
const BIG = 1 << 24;
/** Bytes from a linear congruential generator: nothing for LZ77 to find. */
const noise = (n: number): Uint8Array => {
  let x = 12345;
  return Uint8Array.from({ length: n }, () => {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    return x >>> 24;
  });
};
const text = (s: string) => encodeUtf8(s);

describe('utf8', () => {
  it('FR-FIL-003: text round-trips through UTF-8, and invalid bytes become U+FFFD without throwing', () => {
    const s = 'plain, ünï, 日本語, 😀, ✓';
    expect(decodeUtf8(encodeUtf8(s))).toBe(s);
    expect(decodeUtf8(encodeUtf8('a\ud800b'))).toBe('a�b');
    // a bare continuation, a truncated sequence, an overlong form, a surrogate and a value past U+10FFFF
    for (const bad of [[0x80], [0xe2, 0x82], [0xc0, 0x80], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xff]]) {
      expect(decodeUtf8(Uint8Array.from(bad))).toContain('�');
    }
    fc.assert(fc.property(fc.uint8Array({ maxLength: 64 }), (bytes) => typeof decodeUtf8(bytes) === 'string'));
    expect(decodeUtf8(encodeUtf8('x'.repeat(10000)))).toHaveLength(10000);
  });
});

/** Bytes from `[value, bits]` pairs, least significant bit first. */
const packBits = (fields: ReadonlyArray<readonly [number, number]>): number[] => {
  const out: number[] = [];
  let acc = 0;
  let n = 0;
  for (const [value, bits] of fields) {
    acc |= value << n;
    n += bits;
    while (n >= 8) {
      out.push(acc & 0xff);
      acc >>>= 8;
      n -= 8;
    }
  }
  return n > 0 ? [...out, acc & 0xff] : out;
};
/** A final dynamic block: HLIT, HDIST 0, HCLEN, the code length code's lengths (3 bits each, in the RFC's order), then `body` fields. */
const dynamicHeader = (b: { hclen: number; lengths: number[]; body: Array<[number, number]>; hlit?: number }): number[] =>
  packBits([[1, 1], [2, 2], [b.hlit ?? 0, 5], [0, 5], [b.hclen, 4], ...b.lengths.map((l) => [l, 3] as [number, number]), ...b.body]);

describe('deflate and inflate', () => {
  it('FR-FIL-003: deflate then inflate returns the bytes, for empty, tiny, repetitive, long and random inputs', () => {
    const cases = [new Uint8Array(0), text('a'), text('abcabcabcabcabcabcabcabc'), new Uint8Array(100_000).fill(7), sample(2000)];
    for (const bytes of cases) {
      const back = inflateRaw(deflateRaw(bytes), BIG);
      expect(back.ok && Array.from(back.value)).toEqual(Array.from(bytes));
    }
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 3000 }), (bytes) => {
        const back = inflateRaw(deflateRaw(bytes), BIG);
        return back.ok && back.value.length === bytes.length && back.value.every((b, i) => b === bytes[i]);
      }),
      { numRuns: 300 },
    );
  });

  it('FR-FIL-003: the encoder is deterministic and compresses repetitive text', () => {
    const bytes = sample(500);
    expect(Array.from(deflateRaw(bytes))).toEqual(Array.from(deflateRaw(bytes)));
    expect(deflateRaw(bytes).length).toBeLessThan(bytes.length / 2);
  });

  it('FR-FIL-003: inflate reads fixed, stored and dynamic blocks written by zlib', () => {
    const fixed = inflateRaw(fixture('zlib-fixed.deflate.b64'), BIG);
    expect(fixed.ok && Array.from(fixed.value)).toEqual(Array.from(sample(50)));
    const stored = inflateRaw(fixture('zlib-stored.deflate.b64'), BIG);
    expect(stored.ok && Array.from(stored.value)).toEqual(Array.from(sample(5)));
  });

  it('NFR-REL-002: inflate refuses broken streams with a reason and never throws', () => {
    const reason = (bytes: number[], max = BIG) => {
      const r = inflateRaw(Uint8Array.from(bytes), max);
      return r.ok ? 'ok' : r.error.reason;
    };
    expect(reason([])).toMatch(/ends early/);
    expect(reason([0x07])).toMatch(/reserved type/); // final block, type 3
    expect(reason([0x01, 0x05, 0x00, 0x00, 0x00])).toMatch(/does not match/); // stored LEN 5, NLEN 0
    expect(reason([0x01, 0x05, 0x00])).toMatch(/ends early/);
    expect(reason([0x01, 0x05, 0x00, 0xfa, 0xff, 0x61])).toMatch(/ends early/); // stored: data cut short
    // fixed block: a match with distance 1 before any output (length code 257, distance code 0)
    expect(reason([0x03, 0x02, 0x00])).toMatch(/before the start|ends early/);
    expect(reason(Array.from(deflateRaw(new Uint8Array(1000))), 10)).toMatch(/larger than allowed/);
    const good = Array.from(deflateRaw(sample(100)));
    expect(reason(good.slice(0, 20))).toMatch(/ends early|not in the table/);
    // a dynamic block with HLIT 31 (288 codes)
    expect(reason([0x05, 0xff, 0xff, 0xff])).toMatch(/too many codes|ends early|over-subscribed/);
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 200 }), (bytes) => {
        inflateRaw(bytes, 4096);
        return true;
      }),
      { numRuns: 500 },
    );
    expect(reason(dynamicHeader({ hclen: 0, lengths: [1, 1, 1, 0], body: [] }))).toMatch(/code-length code is over-subscribed/);
    // code length code: symbol 0 and symbol 16 are one bit each, 0 is '0' and 16 is '1'
    const repeatFirst = dynamicHeader({
      hclen: 0,
      lengths: [1, 0, 0, 1],
      body: [
        [1, 1],
        [0, 2],
      ],
    });
    expect(reason(repeatFirst)).toMatch(/nothing to repeat/);
    // symbols 0 ('0') and 18 ('1'): two repeats of 138 zeros pass the 258 lengths
    const past = dynamicHeader({
      hclen: 0,
      lengths: [0, 0, 1, 1],
      body: [
        [1, 1],
        [127, 7],
        [1, 1],
        [127, 7],
      ],
    });
    expect(reason(past)).toMatch(/runs past/);
    // only symbol 0 has a code (one bit): 258 zero lengths, so literal 256 has none
    expect(reason(dynamicHeader({ hclen: 0, lengths: [0, 0, 0, 1], body: Array.from({ length: 258 }, () => [0, 1] as [number, number]) }))).toMatch(
      /no end-of-block/,
    );
    // symbols 0 and 1 have one bit each; every length is 1: 257 literal codes of one bit are over-subscribed
    const ones = Array.from({ length: 258 }, () => [1, 1] as [number, number]);
    expect(reason(dynamicHeader({ hclen: 14, lengths: [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1], body: ones }))).toMatch(/over-subscribed/);
    // a stream of 2 bytes that names 288 literal codes
    expect(reason(dynamicHeader({ hclen: 0, lengths: [0, 0, 0, 1], body: [], hlit: 31 }))).toMatch(/too many codes/);
    // corrupting a real dynamic stream is refused with a reason (never thrown), wherever the damage is
    const sample400 = fixture('zlib-sample.zip.b64');
    const at = sample400.length - 400;
    for (let k = 0; k < 40; k++) {
      const damaged = sample400.slice();
      damaged[at - k * 9] = (damaged[at - k * 9] as number) ^ 0x55;
      expect(readZip(damaged).ok).toBe(false);
    }
  });
});

describe('zip', () => {
  const entries = [
    { name: 'mimetype', bytes: text('application/vnd.fluxion+zip'), method: 'store' as const },
    { name: 'document.json', bytes: sample(300) },
    { name: 'assets/ü.bin', bytes: noise(300) },
    { name: 'empty', bytes: new Uint8Array(0) },
  ];

  it('FR-FIL-003: a zip written twice is byte-identical, with mimetype first, stored and without an extra field', () => {
    const a = writeZip(entries);
    const b = writeZip(entries);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(Array.from(a.value)).toEqual(Array.from(b.value));
    const v = new DataView(a.value.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    expect(v.getUint16(8, true)).toBe(0); // stored
    expect(v.getUint16(28, true)).toBe(0); // no extra field
    expect(decodeUtf8(a.value.subarray(30, 38))).toBe('mimetype');
    expect(v.getUint16(12, true)).toBe(0x21); // 1980-01-01
  });

  it('FR-FIL-003: a one-entry zip has exactly these bytes (the container is pinned, and Python zipfile accepted it)', () => {
    const zip = writeZip([{ name: 'a.txt', bytes: text('hello hello hello hello') }]);
    const hex = zip.ok ? Array.from(zip.value, (b) => b.toString(16).padStart(2, '0')).join('') : '';
    expect(hex).toBe(
      '504b030414000008080000002100e3513d8d090000001700000005000000612e747874cb48cdc9c957c02001504b0102140014000008080000002100e3513d8d0900000017000000050000000000000000000000000000000000612e747874504b05060000000001000100330000002c0000000000',
    );
  });

  it('FR-FIL-003: the entries read back as written, and a poorly compressing entry is stored', () => {
    const zip = writeZip(entries);
    if (!zip.ok) throw new Error(zip.error.reason);
    const read = readZip(zip.value);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.map((e) => e.name)).toEqual(entries.map((e) => e.name));
    for (const [i, e] of read.value.entries()) expect(Array.from(e.bytes)).toEqual(Array.from((entries[i] as { bytes: Uint8Array }).bytes));
    expect(read.value.map((e) => e.method)).toEqual(['store', 'deflate', 'store', 'store']);
  });

  it('FR-FIL-003: readZip reads a zip written by zlib: dynamic, stored and empty entries', () => {
    const read = readZip(fixture('zlib-sample.zip.b64'));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const byName = new Map(read.value.map((e) => [e.name, e]));
    expect(decodeUtf8(byName.get('stored.txt')?.bytes ?? new Uint8Array())).toBe('stored as is');
    expect(Array.from(byName.get('dynamic.json')?.bytes ?? [])).toEqual(Array.from(sample(400)));
    expect(byName.get('empty.txt')?.bytes.length).toBe(0);
    expect(byName.get('dynamic.json')?.method).toBe('deflate');
  });

  it('FR-FIL-009: readZip refuses what exceeds its limits and says which', () => {
    const zip = writeZip(entries);
    if (!zip.ok) throw new Error(zip.error.reason);
    const why = (limits: Parameters<typeof readZip>[1]) => {
      const r = readZip(zip.value, limits);
      return r.ok ? 'ok' : r.error.reason;
    };
    expect(why({ maxEntries: 2 })).toMatch(/4 entries/);
    expect(why({ maxEntryBytes: 1000 })).toMatch(/document.json/);
    expect(why({ maxTotalBytes: 1000 })).toMatch(/more than 1000/);
  });

  it('NFR-REL-002: readZip never throws on truncated, corrupted or hostile bytes', () => {
    const zip = writeZip(entries);
    if (!zip.ok) throw new Error(zip.error.reason);
    const bytes = zip.value;
    expect(readZip(new Uint8Array(0)).ok).toBe(false);
    expect(readZip(text('not a zip at all, but long enough to hold a record')).ok).toBe(false);
    for (let cut = 0; cut < bytes.length; cut += 17) expect(readZip(bytes.subarray(0, cut)).ok).toBe(false);
    fc.assert(
      fc.property(fc.nat(bytes.length - 1), fc.integer({ min: 1, max: 255 }), (at, flip) => {
        const damaged = bytes.slice();
        damaged[at] = (damaged[at] as number) ^ flip;
        readZip(damaged);
        return true;
      }),
      { numRuns: 800 },
    );
    // a checksum that does not match, a method that is not supported, a central directory that points nowhere
    const crcBad = bytes.slice();
    const entryStart = 30 + 8; // the mimetype's data
    crcBad[entryStart] = (crcBad[entryStart] as number) ^ 1;
    expect(JSON.stringify(readZip(crcBad))).toMatch(/checksum|mimetype/);
    const method = bytes.slice();
    new DataView(method.buffer).setUint16(8, 12, true);
    const central = new DataView(method.buffer).getUint32(method.length - 22 + 16, true);
    new DataView(method.buffer).setUint16(central + 10, 12, true);
    expect(JSON.stringify(readZip(method))).toMatch(/not supported/);
    const nowhere = bytes.slice();
    new DataView(nowhere.buffer).setUint32(central + 42, 0xfffffff0, true);
    expect(readZip(nowhere).ok).toBe(false);
  });

  it('FR-FIL-009: a local header that disagrees with the central directory is refused', () => {
    const zip = writeZip([{ name: 'a.txt', bytes: text('hello hello hello hello') }]);
    if (!zip.ok) throw new Error(zip.error.reason);
    const renamed = zip.value.slice();
    renamed[30] = 0x62; // the local header says b.txt
    expect(JSON.stringify(readZip(renamed))).toMatch(/another entry or method/);
    const swapped = zip.value.slice();
    new DataView(swapped.buffer).setUint16(8, 0, true); // the local header says stored
    expect(JSON.stringify(readZip(swapped))).toMatch(/another entry or method/);
  });

  it('NFR-REL-002: a stream that asks for more memory than the host has is a reason, not a throw', () => {
    // one long match repeated against a declared size the host cannot allocate
    const zip = writeZip([{ name: 'big', bytes: new Uint8Array(100_000).fill(1) }]);
    if (!zip.ok) throw new Error(zip.error.reason);
    const huge = zip.value.slice();
    const view = new DataView(huge.buffer);
    const central = view.getUint32(huge.length - 22 + 16, true);
    view.setUint32(central + 24, 0xfffffff0, true);
    const r = readZip(huge, { maxEntryBytes: 0xffffffff, maxTotalBytes: 0xffffffff });
    expect(r.ok).toBe(false);
  });

  it('FR-FIL-003: writeZip refuses an empty name', () => {
    const r = writeZip([{ name: '', bytes: new Uint8Array(0) }]);
    expect(r.ok).toBe(false);
  });
});

describe('crc32', () => {
  it('FR-FIL-003: the CRC-32 of the check string is the standard value', () => {
    expect(crc32(text('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});
