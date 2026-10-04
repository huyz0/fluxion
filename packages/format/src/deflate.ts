// The DEFLATE encoder (RFC 1951) for `.flux` entries: LZ77 over a 32 kB window found by hash chains, coded with the fixed Huffman
// code, in one final block. It is pure and has no tuning that depends on the host, so the same bytes give the same output
// everywhere (FR-FIL-003: a document written twice is byte-identical). The decoder is in `inflate.ts`.
import { DISTANCE_BASE, DISTANCE_EXTRA, LENGTH_BASE, LENGTH_EXTRA } from './deflate-tables.js';

const WINDOW = 32768;
const MIN_MATCH = 3;
const MAX_MATCH = 258;
/** How many earlier positions of one hash are tried: more finds longer matches, slower. */
const MAX_CHAIN = 48;
const HASH_SIZE = 1 << 15;

/** The length code (0..28) of each match length 3..258. */
const LENGTH_CODE = (() => {
  const table = new Uint8Array(MAX_MATCH + 1);
  for (let code = 0; code < LENGTH_BASE.length; code++) {
    const top = code === 28 ? 258 : (LENGTH_BASE[code + 1] as number) - 1;
    for (let len = LENGTH_BASE[code] as number; len <= top; len++) table[len] = code;
  }
  table[258] = 28;
  return table;
})();

/** The distance code (0..29) of `distance` (1..32768). */
function distanceCode(distance: number): number {
  let code = DISTANCE_BASE.length - 1;
  while ((DISTANCE_BASE[code] as number) > distance) code--;
  return code;
}

/** Bits written least significant first, as DEFLATE packs them. */
class BitWriter {
  private buf = new Uint8Array(1024);
  private pos = 0;
  private bits = 0;
  private count = 0;

  private push(byte: number): void {
    if (this.pos === this.buf.length) {
      const grown = new Uint8Array(this.buf.length * 2);
      grown.set(this.buf);
      this.buf = grown;
    }
    this.buf[this.pos++] = byte;
  }

  /** The low `n` bits of `value`, least significant first (n ≤ 16). */
  bitsLsb(value: number, n: number): void {
    this.bits |= value << this.count;
    this.count += n;
    while (this.count >= 8) {
      this.push(this.bits & 0xff);
      this.bits >>>= 8;
      this.count -= 8;
    }
  }

  /** A Huffman code of `n` bits, most significant bit first. */
  code(value: number, n: number): void {
    let reversed = 0;
    for (let i = 0; i < n; i++) reversed |= ((value >> i) & 1) << (n - 1 - i);
    this.bitsLsb(reversed, n);
  }

  finish(): Uint8Array {
    if (this.count > 0) this.push(this.bits & 0xff);
    return this.buf.slice(0, this.pos);
  }
}

/** A literal or length symbol (0..287) in the fixed code. */
function fixedSymbol(out: BitWriter, symbol: number): void {
  if (symbol < 144) out.code(0x30 + symbol, 8);
  else if (symbol < 256) out.code(0x190 + symbol - 144, 9);
  else if (symbol < 280) out.code(symbol - 256, 7);
  else out.code(0xc0 + symbol - 280, 8);
}

/** The hash chains over the input: for each position, the earlier positions with the same three bytes. */
class Matcher {
  private readonly head = new Int32Array(HASH_SIZE).fill(-1);
  private readonly prev: Int32Array;
  private readonly data: Uint8Array;

  constructor(data: Uint8Array) {
    this.data = data;
    this.prev = new Int32Array(data.length);
  }

  private hashAt(i: number): number {
    const d = this.data;
    return ((((d[i] as number) << 10) ^ ((d[i + 1] as number) << 5) ^ (d[i + 2] as number)) & (HASH_SIZE - 1)) >>> 0;
  }

  /** Remember position `i` (the last two positions have no three bytes to hash). */
  insert(i: number): void {
    if (i + 2 >= this.data.length) return;
    const h = this.hashAt(i);
    this.prev[i] = this.head[h] as number;
    this.head[h] = i;
  }

  /** The length of the common run of the bytes at `a` and `i`, at most `limit`. */
  private runLength(a: number, i: number, limit: number): number {
    let len = 0;
    while (len < limit && this.data[a + len] === this.data[i + len]) len++;
    return len;
  }

  /** The longest earlier match for the bytes at `i` (length 0 when none is worth coding). */
  longest(i: number): { readonly length: number; readonly distance: number } {
    const n = this.data.length;
    if (i + 2 >= n) return { length: 0, distance: 0 };
    const limit = Math.min(MAX_MATCH, n - i);
    let best = { length: 0, distance: 0 };
    let candidate = this.head[this.hashAt(i)] as number;
    for (let chain = 0; candidate >= 0 && i - candidate <= WINDOW && chain < MAX_CHAIN; chain++) {
      const length = this.runLength(candidate, i, limit);
      if (length > best.length) best = { length, distance: i - candidate };
      if (length === limit) break;
      candidate = this.prev[candidate] as number;
    }
    // a three-byte match from far away costs more than three literals
    return best.length < MIN_MATCH || (best.length === MIN_MATCH && best.distance > 4096) ? { length: 0, distance: 0 } : best;
  }
}

/** A match as a length symbol, its extra bits, a distance code and its extra bits. */
function fixedMatch(out: BitWriter, length: number, distance: number): void {
  const lc = LENGTH_CODE[length] as number;
  fixedSymbol(out, 257 + lc);
  if ((LENGTH_EXTRA[lc] as number) > 0) out.bitsLsb(length - (LENGTH_BASE[lc] as number), LENGTH_EXTRA[lc] as number);
  const dc = distanceCode(distance);
  out.code(dc, 5);
  if ((DISTANCE_EXTRA[dc] as number) > 0) out.bitsLsb(distance - (DISTANCE_BASE[dc] as number), DISTANCE_EXTRA[dc] as number);
}

/**
 * The raw DEFLATE stream of `data` (no zlib or gzip wrapper): one final block of fixed-Huffman codes.
 * The output is never empty and is deterministic.
 */
export function deflateRaw(data: Uint8Array): Uint8Array {
  const out = new BitWriter();
  out.bitsLsb(1, 1); // BFINAL
  out.bitsLsb(1, 2); // BTYPE 01: fixed Huffman
  const matcher = new Matcher(data);
  let i = 0;
  while (i < data.length) {
    const { length, distance } = matcher.longest(i);
    if (length === 0) {
      fixedSymbol(out, data[i] as number);
      matcher.insert(i);
      i++;
    } else {
      fixedMatch(out, length, distance);
      for (let k = 0; k < length; k++) matcher.insert(i + k);
      i += length;
    }
  }
  fixedSymbol(out, 256);
  return out.finish();
}
