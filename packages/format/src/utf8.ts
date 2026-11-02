// UTF-8 for the pure packages: `TextEncoder` and `TextDecoder` are not in this package's `lib`. A lone surrogate encodes as U+FFFD, and
// invalid bytes decode as U+FFFD, so neither direction ever throws.

const REPLACEMENT = 0xfffd;
/** The most bytes read as one chunk (one call). */
const CHUNK = 8192;
/** The most code points decoded by one call (a spread argument list, as before M18.224). */
const RUN = 4096;
/** A byte that is not ASCII, in a chunk read one byte per character. */
const NOT_ASCII = /[\x80-\xff]/g;
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
    // ASCII, nearly all of a library's text, is written inline: a call and a pair per character dominated its hash under coverage (M18.221)
    const unit = text.charCodeAt(i);
    if (unit < 0x80) {
      out[n++] = unit;
      i++;
      continue;
    }
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

/** An ASCII gap shorter than this is decoded with the code points around it rather than by a search of its own. */
const SHORT_ASCII = 32;

/** The index of the first byte that is not ASCII in `bytes` from `at`, searched SHORT_ASCII bytes at most; -1 when there is none. */
function shortGapEnd(bytes: Uint8Array, at: number): number {
  const stop = Math.min(bytes.length, at + SHORT_ASCII);
  for (let k = at + 1; k < stop; k++) if ((bytes[k] as number) >= 0x80) return k;
  return -1;
}

/**
 * The text of the run at `i` (at most RUN code points) and the index after it; undefined when strict and invalid. The run takes its
 * non-ASCII sequences and the short ASCII gaps between them, so text that alternates the two is not one search per character (r1 F2).
 */
function nonAscii(bytes: Uint8Array, i: number, strict: boolean): { readonly text: string; readonly next: number } | undefined {
  const run: number[] = [];
  let at = i;
  while (at < bytes.length && run.length < RUN) {
    const next = (bytes[at] as number) < 0x80 ? pushGap(bytes, at, run) : pushSequence(bytes, at, strict, run);
    if (next === undefined) return undefined;
    if (next === at) break;
    at = next;
  }
  return { text: String.fromCodePoint(...run), next: at };
}

/** Push the short ASCII gap at `at` onto `run`, taken whole so each byte is looked at once (r2 F4); `at` itself when it is not short. */
function pushGap(bytes: Uint8Array, at: number, run: number[]): number {
  const gapEnd = shortGapEnd(bytes, at);
  if (gapEnd < 0) return at;
  for (let k = at; k < gapEnd; k++) run.push(bytes[k] as number);
  return gapEnd;
}

/** Push the sequence at `at` (U+FFFD for an invalid byte) onto `run`; the index after it, or undefined when strict and invalid. */
function pushSequence(bytes: Uint8Array, at: number, strict: boolean, run: number[]): number | undefined {
  const seq = sequenceAt(bytes, at);
  if (strict && seq === undefined) return undefined;
  run.push(seq?.code ?? REPLACEMENT);
  return at + (seq?.length ?? 1);
}

/**
 * Decode the chunk of `bytes` at `base` into `parts`; the index after it, or undefined when strict and invalid. Bytes are read a chunk
 * per call, one character each, and ASCII is found by a native search: a loop over every byte made decoding a draw.io library's 16 Mi
 * budget most of its import under coverage (M18.224). Each byte is still visited a bounded number of times.
 */
function decodeChunk(bytes: Uint8Array, base: number, strict: boolean, parts: string[]): number | undefined {
  // text that is mostly not ASCII starts here with a run, without reading a chunk it would not use
  if ((bytes[base] as number) >= 0x80) {
    const run = nonAscii(bytes, base, strict);
    if (run === undefined) return undefined;
    parts.push(run.text);
    return run.next;
  }
  // apply rather than a spread: spreading the bytes made decoding 1.8x slower outside coverage (r2 F3)
  const chunk = String.fromCharCode.apply(null, bytes.subarray(base, base + CHUNK) as unknown as number[]);
  const end = base + chunk.length;
  let i = base;
  while (i < end) {
    NOT_ASCII.lastIndex = i - base;
    const found = NOT_ASCII.exec(chunk);
    const high = found ? base + found.index : end;
    if (high > i) parts.push(chunk.slice(i - base, high - base));
    if (high >= end) return end;
    const run = nonAscii(bytes, high, strict);
    if (run === undefined) return undefined;
    parts.push(run.text);
    i = run.next;
  }
  return i;
}

/** The text of the UTF-8 `bytes`; each byte that does not start or continue a valid sequence is one U+FFFD. */
function decode(bytes: Uint8Array, strict: boolean): string | undefined {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; ) {
    const next = decodeChunk(bytes, i, strict, parts);
    if (next === undefined) return undefined;
    i = next;
  }
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
