import { describe, expect, it } from 'vitest';
import { sniffImage } from './image-sniff.js';
import { encodeUtf8 } from './utf8.js';

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, (n >> 8) & 255];
const le24 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
const text = (s: string) => [...s].map((c) => c.charCodeAt(0));
const bytes = (...parts: number[][]) => Uint8Array.from(parts.flat());

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const chunk = (type: string, body: number[]) => [...be32(body.length), ...text(type), ...body, 0, 0, 0, 0];
const png = (w: number, h: number, ...more: number[][]) => bytes(PNG_SIG, chunk('IHDR', [...be32(w), ...be32(h), 8, 6, 0, 0, 0]), ...more);
const jpeg = (w: number, h: number) =>
  bytes(
    [0xff, 0xd8],
    [0xff, 0xe0, 0, 4, 0, 0],
    [0xff, 0xc0, 0, 17, 8, (h >> 8) & 255, h & 255, (w >> 8) & 255, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1],
  );
/** One GIF frame: a graphic control extension, an image descriptor (no local table) and `dataBytes` of image data in 255-byte sub-blocks. */
const frame = (dataBytes: number, fill = 0) => {
  const blocks: number[] = [];
  for (let left = dataBytes; left > 0; left -= 255) blocks.push(Math.min(255, left), ...new Array(Math.min(255, left)).fill(fill));
  return [0x21, 0xf9, 4, 0, 0, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, ...blocks, 0];
};
const gif = (w: number, h: number, ...frames: number[][]) => bytes(text('GIF89a'), le16(w), le16(h), [0, 0, 0], ...frames, [0x3b]);
/** An ISO box: size, type, content. */
const box = (type: string, ...content: number[][]) => {
  const body = content.flat();
  return [...be32(8 + body.length), ...text(type), ...body];
};
const ispe = (w: number, h: number) => box('ispe', [0, 0, 0, 0], be32(w), be32(h));
const avifFile = (brands: string[], w?: number, h?: number, extra: number[] = []) =>
  bytes(
    box('ftyp', text(brands[0] ?? 'avif'), [0, 0, 0, 0], ...brands.slice(1).map(text)),
    w === undefined ? [] : box('meta', [0, 0, 0, 0], box('iprp', box('ipco', ispe(w, h ?? 0)))),
    extra,
  );
const riff = (...body: number[][]) => bytes(text('RIFF'), [0, 0, 0, 0], text('WEBP'), ...body);

describe('sniffImage', () => {
  it('FR-AST-001: a PNG is known by its signature, with its size, whatever it is named', () => {
    expect(sniffImage(png(640, 480))).toEqual({ mime: 'image/png', width: 640, height: 480, animated: false });
    // an APNG has an acTL chunk before its image data
    expect(sniffImage(png(10, 10, chunk('acTL', [0, 0, 0, 2, 0, 0, 0, 0]), chunk('IDAT', [0])))?.animated).toBe(true);
    expect(sniffImage(png(10, 10, chunk('IDAT', [0]), chunk('acTL', [0, 0, 0, 2, 0, 0, 0, 0])))?.animated).toBe(false);
  });

  it('FR-AST-001: a JPEG is known by its start of image, with the size from its first frame marker', () => {
    expect(sniffImage(jpeg(4000, 3000))).toEqual({ mime: 'image/jpeg', width: 4000, height: 3000, animated: false });
    // markers with no frame header before the data: known as a JPEG, without a size
    expect(sniffImage(bytes([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0]))).toEqual({ mime: 'image/jpeg', animated: false });
  });

  it('FR-AST-001: a GIF has its size, and is animated from the second frame', () => {
    expect(sniffImage(gif(30, 20, frame(10)))).toEqual({ mime: 'image/gif', width: 30, height: 20, animated: false });
    expect(sniffImage(gif(30, 20, frame(10), frame(10), frame(10)))?.animated).toBe(true);
    // the frames are found by walking the blocks: a first frame of 2 MB does not hide the second one ...
    expect(sniffImage(gif(30, 20, frame(2_000_000, 1), frame(10)))?.animated).toBe(true);
    // ... and the byte pattern of an extension inside the image data of a single frame does not make it move
    const patterned = [0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 255, ...Array.from({ length: 255 }, (_, k) => [0x21, 0xf9, 4][k % 3] as number), 0];
    expect(sniffImage(gif(30, 20, patterned))?.animated).toBe(false);
    // a walk that runs off the end is a picture that cannot be told apart from a moving one, and is kept
    expect(sniffImage(bytes(text('GIF89a'), le16(1), le16(1), [0, 0, 0], [0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 200, 1, 2, 3]))?.animated).toBe(true);
  });

  it('FR-AST-001: WebP in its three forms: lossy, lossless and extended (animated by its flag)', () => {
    const lossy = riff(text('VP8 '), [10, 0, 0, 0], [0, 0, 0], [0x9d, 0x01, 0x2a], le16(1200), le16(800), [0, 0]);
    expect(sniffImage(lossy)).toEqual({ mime: 'image/webp', width: 1200, height: 800, animated: false });
    // 14 bits of width-1 then 14 bits of height-1 after the 0x2f signature
    const w = 99;
    const h = 49;
    const bits = (w | (h << 14)) >>> 0;
    const lossless = riff(text('VP8L'), [5, 0, 0, 0], [0x2f, bits & 255, (bits >> 8) & 255, (bits >> 16) & 255, (bits >>> 24) & 255]);
    expect(sniffImage(lossless)).toEqual({ mime: 'image/webp', width: 100, height: 50, animated: false });
    const extended = (flags: number) => riff(text('VP8X'), [10, 0, 0, 0], [flags, 0, 0, 0], le24(2999), le24(1999));
    expect(sniffImage(extended(0))).toEqual({ mime: 'image/webp', width: 3000, height: 2000, animated: false });
    expect(sniffImage(extended(0x02))?.animated).toBe(true);
    // a header cut short is a WebP without a size, not a wrong one
    expect(sniffImage(extended(0).subarray(0, 26))).toEqual({ mime: 'image/webp', animated: false });
  });

  it('FR-AST-001: AVIF is known by its brands, with the size of the ispe box found through meta > iprp > ipco; a sequence (avis) is animated', () => {
    expect(sniffImage(avifFile(['avif', 'mif1'], 1920, 1080))).toEqual({ mime: 'image/avif', width: 1920, height: 1080, animated: false });
    expect(sniffImage(avifFile(['avis', 'avif'], 64, 64))?.animated).toBe(true);
    // a still brand first and the sequence brand among the compatible ones is still a sequence
    expect(sniffImage(avifFile(['avif', 'mif1', 'avis'], 64, 64))?.animated).toBe(true);
    // the major brand can be mif1 with avif only compatible
    expect(sniffImage(avifFile(['mif1', 'avif'], 8, 8))).toMatchObject({ mime: 'image/avif', width: 8, height: 8 });
    expect(sniffImage(avifFile(['avif']))).toEqual({ mime: 'image/avif', animated: false });
    // the bytes "ispe" inside another box (here the media data) are not a size
    const decoy = [...be32(8 + 12), ...text('mdat'), ...text('ispe'), 0, 0, 0, 0, ...be32(9999)];
    expect(sniffImage(avifFile(['avif'], undefined, undefined, decoy))).toEqual({ mime: 'image/avif', animated: false });
    // another file of the ftyp family (a video, a HEIC photo) is not an image this import takes
    expect(sniffImage(avifFile(['isom', 'mp41'], 10, 10))).toBeUndefined();
    expect(sniffImage(avifFile(['heic', 'mif1'], 10, 10))).toBeUndefined();
  });

  it('NFR-REL-002: an ftyp box that claims the whole file is read for a few brands, not millions', () => {
    // 16 MB of 'avif' brands under a box size of 0xFFFFFFFF (to the end of the file): the first 64 are read and the answer is the same
    const header = [0xff, 0xff, 0xff, 0xff, ...text('ftyp'), ...text('avif'), 0, 0, 0, 0];
    const body = new Uint8Array(16 * 1024 * 1024);
    body.set(header);
    for (let i = header.length; i + 4 <= body.length; i += 4) body.set(text('avif'), i);
    expect(sniffImage(body)).toMatchObject({ mime: 'image/avif', animated: false });
    // an avis brand after the first 64 is not looked for
    const late = body.slice();
    late.set(text('avis'), header.length + 4 * 70);
    expect(sniffImage(late)?.animated).toBe(false);
  });

  it('FR-AST-001: SVG is text that starts as SVG, after a BOM, a prolog, a doctype or a comment; other text is not an image', () => {
    const svg = { mime: 'image/svg+xml', animated: false };
    expect(sniffImage(encodeUtf8('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toEqual(svg);
    expect(sniffImage(encodeUtf8('﻿  <?xml version="1.0"?>\n<!-- c -->\n<svg width="1"/>'))).toEqual(svg);
    expect(sniffImage(encodeUtf8('<!doctype svg PUBLIC "x" "y"><svg/>'))).toEqual(svg);
    for (const not of ['<html><svg/></html>', 'hello <svg/>', '<svgfoo/>', '', '%PDF-1.7']) expect(sniffImage(encodeUtf8(not)), not).toBeUndefined();
  });

  it('NFR-REL-002: truncated headers and random bytes are never a throw: unknown or without a size', () => {
    expect(sniffImage(new Uint8Array(0))).toBeUndefined();
    for (const cut of [1, 3, 8, 12, 20, 23]) expect(sniffImage(png(5, 5).subarray(0, cut)), `png ${cut}`).toBeUndefined();
    for (let n = 0; n < 64; n++) sniffImage(Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 255));
    // a JPEG whose segment length runs past the data stops at the end instead of reading on
    expect(sniffImage(bytes([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 1, 2, 3]))).toEqual({ mime: 'image/jpeg', animated: false });
  });
});
