// UTF-8 for the pure packages: `TextEncoder` and `TextDecoder` are not in this package's `lib`. A lone surrogate encodes as U+FFFD, and
// invalid bytes decode as U+FFFD, so neither direction ever throws.

const REPLACEMENT = 0xfffd;
/** The smallest code point that needs this many continuation bytes (shorter forms of it are overlong). */
const MIN_FOR = [0, 0x80, 0x800, 0x10000];

/** The code point at UTF-16 index `i` of `text` (a lone surrogate is U+FFFD) and how many units it spans. */
function codePointAt(text: string, i: number): readonly [code: number, units: 1 | 2] {
  const c = text.charCodeAt(i);
  if (c < 0xd800 || c > 0xdfff) return [c, 1];
  const low = text.charCodeAt(i + 1);
  return c <= 0xdbff && low >= 0xdc00 && low <= 0xdfff ? [0x10000 + ((c - 0xd800) << 10) + (low - 0xdc00), 2] : [REPLACEMENT, 1];
}

/** Write the UTF-8 bytes of code point `c` into `out` at `n`; the index after them. */
function writeCodePoint(out: Uint8Array, n: number, c: number): number {
  if (c < 0x80) {
    out[n] = c;
    return n + 1;
  }
  const tail = c < 0x800 ? 1 : c < 0x10000 ? 2 : 3;
  out[n] = ((0xff00 >> (tail + 1)) & 0xff) | (c >> (6 * tail));
  for (let k = 1; k <= tail; k++) out[n + k] = 0x80 | ((c >> (6 * (tail - k))) & 63);
  return n + tail + 1;
}

/** The UTF-8 bytes of `text`, written into one buffer sized for the worst case (3 bytes per UTF-16 unit): a per-character array made
 * a 3 Mi-character library take 180 ms to hash, the bulk of a bounded-time import test's budget on a loaded runner (M18.117). */
export function encodeUtf8(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 3);
  let n = 0;
  for (let i = 0; i < text.length; ) {
    const [code, units] = codePointAt(text, i);
    n = writeCodePoint(out, n, code);
    i += units;
  }
  return out.slice(0, n);
}

/** How many continuation bytes the lead byte `b` asks for (0: it is not a lead byte). */
const continuationsOf = (b: number): number => (b >= 0xc2 && b < 0xe0 ? 1 : b >= 0xe0 && b < 0xf0 ? 2 : b >= 0xf0 && b < 0xf5 ? 3 : 0);

/** The code point of the multi-byte sequence at `i` and its length, or undefined when it is not a valid one. */
function sequenceAt(bytes: Uint8Array, i: number): { readonly code: number; readonly length: number } | undefined {
  const b = bytes[i] as number;
  const need = continuationsOf(b);
  let code = b & (0x3f >> need);
  for (let k = 1; k <= need; k++) {
    const next = bytes[i + k];
    if (next === undefined || (next & 0xc0) !== 0x80) return undefined;
    code = (code << 6) | (next & 63);
  }
  const valid = need > 0 && code >= (MIN_FOR[need] as number) && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
  return valid ? { code, length: need + 1 } : undefined;
}

/** The text of the UTF-8 `bytes`; each byte that does not start or continue a valid sequence is one U+FFFD. */
function decode(bytes: Uint8Array, strict: boolean): string | undefined {
  const parts: string[] = [];
  let run: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i] as number;
    const seq = b < 0x80 ? { code: b, length: 1 } : sequenceAt(bytes, i);
    if (strict && seq === undefined) return undefined;
    run.push(seq?.code ?? REPLACEMENT);
    i += seq?.length ?? 1;
    if (run.length >= 4096) {
      parts.push(String.fromCodePoint(...run));
      run = [];
    }
  }
  parts.push(String.fromCodePoint(...run));
  return parts.join('');
}

/** Decode with the established replacement behavior. */
export function decodeUtf8(bytes: Uint8Array): string {
  return decode(bytes, false) ?? '';
}

/** Refuse malformed byte sequences instead of silently replacing them. */
export function decodeUtf8Strict(bytes: Uint8Array): string | undefined {
  return decode(bytes, true);
}
