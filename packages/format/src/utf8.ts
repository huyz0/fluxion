// UTF-8 for the pure packages: `TextEncoder` and `TextDecoder` are not in this package's `lib`. A lone surrogate encodes as U+FFFD, and
// invalid bytes decode as U+FFFD, so neither direction ever throws.

const REPLACEMENT = 0xfffd;
/** The smallest code point that needs this many continuation bytes (shorter forms of it are overlong). */
const MIN_FOR = [0, 0x80, 0x800, 0x10000];

/** The UTF-8 bytes of the code point `c`. */
function bytesOf(c: number): number[] {
  if (c < 0x80) return [c];
  if (c < 0x800) return [0xc0 | (c >> 6), 0x80 | (c & 63)];
  if (c < 0x10000) return [0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)];
  return [0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)];
}

/** The UTF-8 bytes of `text`. */
export function encodeUtf8(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? REPLACEMENT;
    out.push(...bytesOf(c >= 0xd800 && c <= 0xdfff ? REPLACEMENT : c));
  }
  return Uint8Array.from(out);
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
export function decodeUtf8(bytes: Uint8Array): string {
  const parts: string[] = [];
  let run: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i] as number;
    const seq = b < 0x80 ? { code: b, length: 1 } : sequenceAt(bytes, i);
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
