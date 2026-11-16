// decodePng pinned (M19.27, M18 cp51 F4): the pixel specs read their screenshots with this Node decoder, so a mistake in it would compare the
// wrong pixels in every one of them. These cases encode PNGs here (each row with its own filter, RGB and RGBA) and check the decoder gives
// back the pixels they were made from; one image is checked against bytes written out by hand. The nightly png-check job checks the decoder
// against the browser's on real screenshots (FLUXION_PNG_CHECK: 1).
import { crc32, deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodePng } from './image-diff.js';

type Image = { readonly w: number; readonly h: number; readonly channels: 3 | 4; readonly bytes: Uint8Array };

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}

/** The IHDR body: size, depth, colour type and interlace (compression and filter method 0). */
function header(w: number, h: number, { depth = 8, color = 6, interlace = 0 } = {}): Buffer {
  const b = Buffer.alloc(13);
  b.writeUInt32BE(w, 0);
  b.writeUInt32BE(h, 4);
  b[8] = depth;
  b[9] = color;
  b[12] = interlace;
  return b;
}

function paeth(a: number, b: number, c: number): number {
  const e = a + b - c;
  const [pa, pb, pc] = [Math.abs(e - a), Math.abs(e - b), Math.abs(e - c)];
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Row `y` of `img` filtered with `filter` (0 none, 1 sub, 2 up, 3 average, 4 Paeth), as an encoder writes it. */
function filterRow(img: Image, y: number, filter: number): number[] {
  const stride = img.w * img.channels;
  const at = (x: number, row: number) => (x < 0 || row < 0 ? 0 : (img.bytes[row * stride + x] as number));
  const out = [filter];
  for (let x = 0; x < stride; x++) {
    const [v, a, b, c] = [at(x, y), at(x - img.channels, y), at(x, y - 1), at(x - img.channels, y - 1)];
    const predicted = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter] as number;
    out.push((v - predicted) & 0xff);
  }
  return out;
}

/** `img` as a PNG whose row `y` uses filter `filters[y % filters.length]`; its IDAT split in two chunks. */
function encode(img: Image, filters: readonly number[]): Buffer {
  const raw = Buffer.from(Array.from({ length: img.h }, (_, y) => filterRow(img, y, filters[y % filters.length] as number)).flat());
  const z = deflateSync(raw);
  const half = Math.floor(z.length / 2);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header(img.w, img.h, { color: img.channels === 4 ? 6 : 2 })),
    chunk('IDAT', z.subarray(0, half)),
    chunk('IDAT', z.subarray(half)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A w × h image of pseudo-random bytes (a fixed linear congruential sequence), so every filter sees varied neighbours. */
function noise(w: number, h: number, channels: 3 | 4, seed: number): Image {
  const bytes = new Uint8Array(w * h * channels);
  let s = seed;
  for (let i = 0; i < bytes.length; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    bytes[i] = s >>> 24;
  }
  return { w, h, channels, bytes };
}

/** RGB bytes as opaque RGBA, as the decoder gives them. */
const opaque = (img: Image): Uint8Array =>
  img.channels === 4
    ? img.bytes
    : Uint8Array.from({ length: img.w * img.h * 4 }, (_, i) => (i % 4 === 3 ? 255 : (img.bytes[(i >> 2) * 3 + (i % 4)] as number)));

describe('decodePng (M19.27)', () => {
  it.each([
    [0, 'none'],
    [1, 'sub'],
    [2, 'up'],
    [3, 'average'],
    [4, 'Paeth'],
  ])('HARNESS: rows filtered with %i (%s) decode to the pixels they were made from, in RGB and RGBA', (filter) => {
    for (const channels of [3, 4] as const) {
      const img = noise(7, 5, channels, 17 + filter);
      expect(decodePng(encode(img, [filter])), `${channels} channels`).toEqual({ w: 7, h: 5, data: opaque(img) });
    }
  });

  it('HARNESS: one image mixing all five filters row by row decodes exactly, in RGB and RGBA', () => {
    for (const channels of [3, 4] as const) {
      const img = noise(33, 12, channels, 99);
      const out = decodePng(encode(img, [4, 0, 3, 1, 2]));
      expect([out.w, out.h]).toEqual([33, 12]);
      expect(Buffer.from(out.data).equals(Buffer.from(opaque(img))), `${channels} channels`).toBe(true);
    }
  });

  it('HARNESS: a 2 × 2 RGB image decodes to the RGBA bytes written out by hand', () => {
    const img: Image = { w: 2, h: 2, channels: 3, bytes: Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 10, 20, 30]) };
    const out = decodePng(encode(img, [1, 4]));
    expect([...out.data]).toEqual([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 10, 20, 30, 255]);
  });

  it('HARNESS: a file that is not a PNG, a 16-bit depth, a palette image and an interlaced one throw', () => {
    const png = (h: Buffer) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', h), chunk('IEND', Buffer.alloc(0))]);
    expect(() => decodePng(Buffer.from('GIF89a and more bytes'))).toThrow('not a PNG');
    expect(() => decodePng(png(header(1, 1, { depth: 16 })))).toThrow('unsupported PNG: depth 16');
    expect(() => decodePng(png(header(1, 1, { color: 3 })))).toThrow('unsupported PNG');
    expect(() => decodePng(png(header(1, 1, { interlace: 1 })))).toThrow('interlace 1');
  });
});
