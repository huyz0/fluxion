// The DEFLATE decoder (RFC 1951): stored, fixed-Huffman and dynamic-Huffman blocks, with a cap on the output so a hostile stream
// cannot expand without bound (FR-FIL-009, NFR-REL-002). It never throws: a stream that is cut short, malformed or too large is a
// `reason`. The canonical-code decoding follows zlib's `puff.c`.
import { err, ok, type Result } from '@fluxion/schema';
import { DISTANCE_BASE, DISTANCE_EXTRA, LENGTH_BASE, LENGTH_EXTRA } from './deflate-tables.js';

/** Why a stream was refused. */
export type InflateFailure = {
  /** What is wrong, for a diagnostic. */
  readonly reason: string;
};

const MAX_BITS = 15;
/** The order the code-length code lengths come in (RFC 1951 §3.2.7). */
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** A canonical Huffman code: how many codes of each length, and the symbols in code order. */
type Huffman = { readonly count: Uint16Array; readonly symbol: Uint16Array };

/** The code for `lengths`, or undefined when it is over-subscribed. An incomplete code is allowed (RFC 1951 permits one distance code). */
function buildHuffman(lengths: readonly number[]): Huffman | undefined {
  const count = new Uint16Array(MAX_BITS + 1);
  for (const len of lengths) count[len] = (count[len] as number) + 1;
  let left = 1;
  for (let len = 1; len <= MAX_BITS; len++) {
    left = left * 2 - (count[len] as number);
    if (left < 0) return undefined;
  }
  const offsets = new Uint16Array(MAX_BITS + 2);
  for (let len = 1; len <= MAX_BITS; len++) offsets[len + 1] = (offsets[len] as number) + (count[len] as number);
  const symbol = new Uint16Array(lengths.length);
  lengths.forEach((len, sym) => {
    if (len === 0) return;
    const at = offsets[len] as number;
    symbol[at] = sym;
    offsets[len] = at + 1;
  });
  return { count, symbol };
}

/** The fixed codes of block type 01. */
const FIXED_LITERAL = buildHuffman([...Array(144).fill(8), ...Array(112).fill(9), ...Array(24).fill(7), ...Array(8).fill(8)]) as Huffman;
const FIXED_DISTANCE = buildHuffman(Array(30).fill(5)) as Huffman;

/** Thrown by the decoder's helpers to stop at the first fault; caught in `inflateRaw`, never seen by callers. */
class Stop extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

const fail = (reason: string): never => {
  throw new Stop(reason);
};

/** The decoder's state: the input and its bit position, the output so far and its cap. */
class Inflater {
  private pos = 0;
  private bitBuf = 0;
  private bitCount = 0;
  private out: Uint8Array;
  private outPos = 0;
  private readonly src: Uint8Array;
  private readonly maxOut: number;

  constructor(src: Uint8Array, maxOut: number) {
    this.src = src;
    this.maxOut = maxOut;
    this.out = new Uint8Array(Math.min(Math.max(src.length * 4, 1024), maxOut + 1));
  }

  result(): Uint8Array {
    return this.out.slice(0, this.outPos);
  }

  private bits(need: number): number {
    while (this.bitCount < need) {
      if (this.pos >= this.src.length) fail('the stream ends early');
      this.bitBuf |= (this.src[this.pos++] as number) << this.bitCount;
      this.bitCount += 8;
    }
    const value = this.bitBuf & ((1 << need) - 1);
    this.bitBuf >>>= need;
    this.bitCount -= need;
    return value;
  }

  private decode(h: Huffman): number {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len <= MAX_BITS; len++) {
      code |= this.bits(1);
      const count = h.count[len] as number;
      if (code - count < first) return h.symbol[index + (code - first)] as number;
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    return fail('a code is not in the table');
  }

  private put(byte: number): void {
    if (this.outPos >= this.maxOut) fail('the output is larger than allowed');
    if (this.outPos === this.out.length) {
      const grown = new Uint8Array(Math.min(this.out.length * 2, this.maxOut + 1));
      grown.set(this.out);
      this.out = grown;
    }
    this.out[this.outPos++] = byte;
  }

  /** One length and distance pair of a block, copied from the output so far. */
  private copy(symbol: number, distance: Huffman): void {
    const lc = symbol - 257;
    if (lc >= LENGTH_BASE.length) fail('a length code is out of range');
    const length = (LENGTH_BASE[lc] as number) + this.bits(LENGTH_EXTRA[lc] as number);
    const dc = this.decode(distance);
    if (dc >= DISTANCE_BASE.length) fail('a distance code is out of range');
    const dist = (DISTANCE_BASE[dc] as number) + this.bits(DISTANCE_EXTRA[dc] as number);
    if (dist > this.outPos) fail('a match reaches before the start of the output');
    for (let k = 0; k < length; k++) this.put(this.out[this.outPos - dist] as number);
  }

  private codes(literal: Huffman, distance: Huffman): void {
    for (let symbol = this.decode(literal); symbol !== 256; symbol = this.decode(literal)) {
      if (symbol < 256) this.put(symbol);
      else this.copy(symbol, distance);
    }
  }

  private stored(): void {
    // drop the rest of the byte, then LEN and its complement
    this.bitBuf = 0;
    this.bitCount = 0;
    if (this.pos + 4 > this.src.length) fail('the stream ends early');
    const len = (this.src[this.pos] as number) | ((this.src[this.pos + 1] as number) << 8);
    const nlen = (this.src[this.pos + 2] as number) | ((this.src[this.pos + 3] as number) << 8);
    if (len !== (~nlen & 0xffff)) fail('a stored block length does not match its complement');
    this.pos += 4;
    if (this.pos + len > this.src.length) fail('the stream ends early');
    for (let k = 0; k < len; k++) this.put(this.src[this.pos + k] as number);
    this.pos += len;
  }

  /** The length a repeat symbol (16, 17 or 18) repeats and how many times, given the lengths so far. */
  private repeatOf(symbol: number, all: readonly number[]): { readonly value: number; readonly times: number } {
    if (symbol === 16) return { value: all.at(-1) ?? fail('a repeat has nothing to repeat'), times: 3 + this.bits(2) };
    return symbol === 17 ? { value: 0, times: 3 + this.bits(3) } : { value: 0, times: 11 + this.bits(7) };
  }

  /** The `total` code lengths of a dynamic block, run-length coded with `lengthCode`. */
  private codeLengths(lengthCode: Huffman, total: number): number[] {
    const all: number[] = [];
    while (all.length < total) {
      const symbol = this.decode(lengthCode);
      if (symbol < 16) {
        all.push(symbol);
        continue;
      }
      const { value, times } = this.repeatOf(symbol, all);
      if (all.length + times > total) fail('a repeat runs past the code lengths');
      for (let k = 0; k < times; k++) all.push(value);
    }
    return all;
  }

  private dynamic(): void {
    const hlit = this.bits(5) + 257;
    const hdist = this.bits(5) + 1;
    const hclen = this.bits(4) + 4;
    if (hlit > 286 || hdist > 30) fail('a dynamic block names too many codes');
    const lengths: number[] = Array(19).fill(0);
    for (let i = 0; i < hclen; i++) lengths[CODE_LENGTH_ORDER[i] as number] = this.bits(3);
    const lengthCode = buildHuffman(lengths) ?? fail('the code-length code is over-subscribed');
    const all = this.codeLengths(lengthCode, hlit + hdist);
    if (all[256] === 0) fail('a dynamic block has no end-of-block code');
    const literal = buildHuffman(all.slice(0, hlit));
    const distance = buildHuffman(all.slice(hlit));
    if (literal === undefined || distance === undefined) fail('a dynamic code is over-subscribed');
    this.codes(literal as Huffman, distance as Huffman);
  }

  /** Decode blocks up to and including the final one. */
  run(): void {
    for (let last = 0; last === 0; ) {
      last = this.bits(1);
      const type = this.bits(2);
      if (type === 0) this.stored();
      else if (type === 1) this.codes(FIXED_LITERAL, FIXED_DISTANCE);
      else if (type === 2) this.dynamic();
      else fail('a block has the reserved type');
    }
  }
}

/** Inflate `src` and give at most `maxOut` bytes; a longer stream is refused. */
export function inflateRaw(src: Uint8Array, maxOut: number): Result<Uint8Array, InflateFailure> {
  const inflater = new Inflater(src, maxOut);
  try {
    inflater.run();
  } catch (e) {
    if (e instanceof Stop) return err({ reason: e.reason });
    // the host refused a large buffer: a hostile stream asking for more than it can give
    if (e instanceof RangeError) return err({ reason: 'the output does not fit in memory' });
    throw e;
  }
  return ok(inflater.result());
}
