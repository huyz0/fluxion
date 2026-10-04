// Telling what an image file is from its first bytes (FR-AST-001, ADR-0025): never from its name or the media type the host claims. The header
// is read for the pixel size and for the animated forms (an animated GIF, APNG, WebP or AVIF sequence), which re-encoding would flatten. Every
// read is bounded, and a file that is not one of the six kinds is `undefined`.
import { decodeUtf8 } from './utf8.js';

/**
 * The media types an import accepts.
 *
 * @public
 */
export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/avif' | 'image/gif' | 'image/svg+xml';

/**
 * What the first bytes of an image say.
 *
 * @public
 */
export type ImageInfo = {
  /** The media type the bytes are (not the one the file was named or sent with). */
  readonly mime: ImageMime;
  /** Pixel width from the header; undefined for an SVG, or when the header does not say. */
  readonly width?: number;
  /** Pixel height from the header; undefined for an SVG, or when the header does not say. */
  readonly height?: number;
  /** True for a form that moves (GIF with more than one frame, APNG, animated WebP, an AVIF sequence): re-encoding would keep one frame. */
  readonly animated: boolean;
};

const u16be = (b: Uint8Array, i: number): number => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
const u16le = (b: Uint8Array, i: number): number => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
const u24le = (b: Uint8Array, i: number): number => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8) | ((b[i + 2] ?? 0) << 16);
const u32be = (b: Uint8Array, i: number): number => (((b[i] ?? 0) << 24) | ((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0)) >>> 0;
const ascii = (b: Uint8Array, i: number, n: number): string => String.fromCharCode(...b.subarray(i, i + n));
const startsWith = (b: Uint8Array, magic: readonly number[]): boolean => magic.every((v, i) => b[i] === v);

/** The most compatible brands read from an `ftyp` box. */
const MAX_BRANDS = 64;

/** The most bytes of a header any reader looks at. */
const HEADER = 64 * 1024;

function png(b: Uint8Array): ImageInfo {
  // chunks follow the signature; an `acTL` chunk before the first `IDAT` makes it an APNG
  let animated = false;
  for (let at = 8; at + 8 <= Math.min(b.length, HEADER); ) {
    const type = ascii(b, at + 4, 4);
    if (type === 'acTL') animated = true;
    if (type === 'IDAT') break;
    at += 12 + u32be(b, at);
  }
  return { mime: 'image/png', width: u32be(b, 16), height: u32be(b, 20), animated };
}

function jpeg(b: Uint8Array): ImageInfo {
  // markers: FF xx, then a length; the first start-of-frame marker carries the size
  let at = 2;
  while (at + 4 <= Math.min(b.length, HEADER) && b[at] === 0xff) {
    const marker = b[at + 1] as number;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { mime: 'image/jpeg', width: u16be(b, at + 7), height: u16be(b, at + 5), animated: false };
    }
    at += marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) ? 2 : 2 + u16be(b, at + 2);
  }
  return { mime: 'image/jpeg', animated: false };
}

/** The position after the data sub-blocks that start at `at` (each is a length byte and that many bytes; a zero length ends them), or -1 past the end. */
function skipSubBlocks(b: Uint8Array, at: number): number {
  let pos = at;
  while (pos < b.length) {
    const size = b[pos] as number;
    pos += 1 + size;
    if (size === 0) return pos;
  }
  return -1;
}

/** How many bytes a colour table takes when `flags` says one follows (bit 7), its size in the low three bits. */
const tableBytes = (flags: number): number => ((flags & 0x80) === 0 ? 0 : 3 * 2 ** ((flags & 7) + 1));

/** The block at `pos`: where the next one starts (-1 past the end) and whether it is a frame; undefined for a block that is neither an extension nor a frame. */
function gifBlock(b: Uint8Array, pos: number): { readonly next: number; readonly frame: boolean } | undefined {
  if (b[pos] === 0x21) return { next: skipSubBlocks(b, pos + 2), frame: false };
  // an image descriptor is nine bytes, then a local colour table, the LZW code size byte and the data
  if (b[pos] === 0x2c) return { next: skipSubBlocks(b, pos + 10 + tableBytes(b[pos + 9] ?? 0) + 1), frame: true };
  return undefined;
}

/**
 * Whether the GIF `b` has more than one frame, by walking its blocks (not by looking for byte patterns, which also occur inside image data):
 * extensions are skipped, each image descriptor is a frame. A file the walk cannot follow counts as moving, so it is kept as it is.
 */
function gifMoves(b: Uint8Array): boolean {
  let pos = 13 + tableBytes(b[10] ?? 0);
  let frames = 0;
  while (pos >= 0 && pos < b.length) {
    if (b[pos] === 0x3b) return false;
    const block = gifBlock(b, pos);
    if (block === undefined) return true;
    if (block.frame && ++frames > 1) return true;
    pos = block.next;
  }
  // a block that ran past the end is moving; the end of the data after whole blocks is not
  return pos < 0;
}

function gif(b: Uint8Array): ImageInfo {
  return { mime: 'image/gif', width: u16le(b, 6), height: u16le(b, 8), animated: gifMoves(b) };
}

function webp(b: Uint8Array): ImageInfo {
  const chunk = ascii(b, 12, 4);
  // each form's header is a different length: a truncated one is a WebP without a size
  if (chunk === 'VP8X' && b.length >= 30)
    return { mime: 'image/webp', width: u24le(b, 24) + 1, height: u24le(b, 27) + 1, animated: ((b[20] ?? 0) & 0x02) !== 0 };
  if (chunk === 'VP8 ' && b.length >= 30) return { mime: 'image/webp', width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff, animated: false };
  if (chunk === 'VP8L' && b.length >= 25) {
    const bits = (b[21] ?? 0) | ((b[22] ?? 0) << 8) | ((b[23] ?? 0) << 16) | ((b[24] ?? 0) << 24);
    return { mime: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, animated: false };
  }
  return { mime: 'image/webp', animated: false };
}

/** The content range of the first box of `type` among the boxes in `[from, to)`, or undefined; a box is a 32-bit size, a type and its content. */
function findBox(b: Uint8Array, type: string, from: number, to: number): { readonly start: number; readonly end: number } | undefined {
  let pos = from;
  for (let n = 0; n < 4096 && pos + 8 <= Math.min(to, b.length); n++) {
    const size = u32be(b, pos);
    const end = size === 0 ? Math.min(to, b.length) : pos + size;
    if (size !== 0 && size < 8) return undefined;
    if (ascii(b, pos + 4, 4) === type) return { start: pos + 8, end: Math.min(end, b.length) };
    pos = end;
  }
  return undefined;
}

/** The brands of the `ftyp` box at the start of `b`: the major brand and every compatible brand. */
function brandsOf(b: Uint8Array): readonly string[] {
  const box = findBox(b, 'ftyp', 0, 4096);
  if (box === undefined) return [];
  const brands = [ascii(b, box.start, 4)];
  // a real ftyp lists a handful of brands: a box that claims the whole file is read for the first 64 only
  for (let at = box.start + 8, n = 0; at + 4 <= box.end && n < MAX_BRANDS; at += 4, n++) brands.push(ascii(b, at, 4));
  return brands;
}

function avif(b: Uint8Array, brands: readonly string[]): ImageInfo {
  // the size is the first `ispe` (image spatial extents) in meta > iprp > ipco, read through the box structure: version and flags, then width and height
  const animated = brands.includes('avis');
  const meta = findBox(b, 'meta', 0, b.length);
  const iprp = meta === undefined ? undefined : findBox(b, 'iprp', meta.start + 4, meta.end);
  const ipco = iprp === undefined ? undefined : findBox(b, 'ipco', iprp.start, iprp.end);
  const ispe = ipco === undefined ? undefined : findBox(b, 'ispe', ipco.start, ipco.end);
  if (ispe === undefined || ispe.end - ispe.start < 12) return { mime: 'image/avif', animated };
  return { mime: 'image/avif', width: u32be(b, ispe.start + 4), height: u32be(b, ispe.start + 8), animated };
}

/** Whether `b` starts as SVG text: an optional BOM and XML prolog or doctype, then an `<svg` element within the first 2 kB. */
function looksSvg(b: Uint8Array): boolean {
  const head = decodeUtf8(b.subarray(0, 2048)).replace(/^﻿/, '').trimStart();
  if (!head.startsWith('<')) return false;
  return /^<svg[\s>/]/i.test(head) || (/^<(\?xml|!doctype|!--)/i.test(head) && /<svg[\s>/]/i.test(head));
}

/** The binary formats, by their magic bytes: the header reader of the first that matches. */
function sniffBinary(bytes: Uint8Array): ImageInfo | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) && bytes.length >= 24) return png(bytes);
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return jpeg(bytes);
  if (ascii(bytes, 0, 4) === 'GIF8' && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61 && bytes.length >= 10) return gif(bytes);
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP' && bytes.length >= 16) return webp(bytes);
  const brands = ascii(bytes, 4, 4) === 'ftyp' ? brandsOf(bytes) : [];
  return brands.includes('avif') || brands.includes('avis') ? avif(bytes, brands) : undefined;
}

/**
 * What `bytes` is, from its first bytes: PNG, JPEG, GIF, WebP, AVIF or SVG, with its pixel size when the header has one and whether it
 * moves. Anything else (a PDF, a text file, a truncated header) is undefined.
 *
 * @public
 */
export function sniffImage(bytes: Uint8Array): ImageInfo | undefined {
  return sniffBinary(bytes) ?? (looksSvg(bytes) ? { mime: 'image/svg+xml', animated: false } : undefined);
}
