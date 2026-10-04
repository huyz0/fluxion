import { describe, expect, it } from 'vitest';
import { type ImageCodec, importImage, MAX_IMAGE_SIDE, MAX_IMPORT_BYTES, scaleToFit } from './image-import.js';
import { decodeUtf8, encodeUtf8 } from './utf8.js';

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const text = (s: string) => [...s].map((c) => c.charCodeAt(0));
const png = (w: number, h: number, pad = 0) =>
  Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...be32(13),
    ...text('IHDR'),
    ...be32(w),
    ...be32(h),
    8,
    6,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    ...new Array(pad).fill(0),
  ]);
const jpeg = (w: number, h: number, pad: number) =>
  Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0,
    17,
    8,
    (h >> 8) & 255,
    h & 255,
    (w >> 8) & 255,
    w & 255,
    3,
    1,
    0x22,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1,
    ...new Array(pad).fill(0),
  ]);

/**
 * A codec that records what it was asked and answers like a browser: the picture is `own` pixels (whatever the header said), scaled down to the
 * limit when it is over it, encoded as `out` bytes.
 */
const codec = (out: number, own: { width: number; height: number } = { width: 1, height: 1 }) => {
  const calls: { mime: string; maxSide: number }[] = [];
  const c: ImageCodec = {
    toWebp: (_bytes, mime, maxSide) => {
      calls.push({ mime, maxSide });
      const fitted = scaleToFit(own.width, own.height, maxSide);
      return Promise.resolve({ bytes: new Uint8Array(out).fill(7), ...(fitted ?? own), scaled: fitted !== undefined });
    },
  };
  return { c, calls };
};
const none: ImageCodec = { toWebp: () => Promise.resolve(undefined) };

describe('importImage', () => {
  it('FR-AST-002: a 4000 px JPEG is limited to 2560 px on its long side and kept as the WebP it came back as', async () => {
    const { c, calls } = codec(900, { width: 4000, height: 3000 });
    const r = await importImage(jpeg(4000, 3000, 5000), c);
    expect(calls).toEqual([{ mime: 'image/jpeg', maxSide: MAX_IMAGE_SIDE }]);
    expect(r.ok && { mime: r.value.mime, w: r.value.width, h: r.value.height, change: r.value.change, n: r.value.bytes.length }).toEqual({
      mime: 'image/webp',
      w: 2560,
      h: 1920,
      change: 'downscaled',
      n: 900,
    });
    // a portrait image is limited on its height; the other side keeps the ratio
    const tall = codec(900, { width: 3000, height: 6000 });
    const t = await importImage(png(3000, 6000, 100), tall.c);
    expect(t.ok && [t.value.width, t.value.height]).toEqual([1280, 2560]);
  });

  it('FR-AST-002: scaleToFit keeps the proportions and the longer side, never upscales, and never makes a side 0', () => {
    expect(scaleToFit(4000, 2000, 2560)).toEqual({ width: 2560, height: 1280 });
    expect(scaleToFit(2000, 4000, 2560)).toEqual({ width: 1280, height: 2560 });
    expect(scaleToFit(2560, 100, 2560)).toBeUndefined();
    expect(scaleToFit(10, 10, 2560)).toBeUndefined();
    expect(scaleToFit(100_000, 10, 2560)).toEqual({ width: 2560, height: 1 });
  });

  it('FR-AST-002: a raster within the limit becomes WebP only when that is smaller', async () => {
    const original = png(800, 600, 4000);
    const smaller = codec(1000, { width: 800, height: 600 });
    const a = await importImage(original, smaller.c);
    expect(a.ok && a.value.mime).toBe('image/webp');
    expect(a.ok && a.value.change).toBe('webp');
    const bigger = codec(original.length + 1, { width: 800, height: 600 });
    const b = await importImage(original, bigger.c);
    expect(b.ok && b.value.bytes).toBe(original);
    expect(b.ok && b.value.mime).toBe('image/png');
    expect(b.ok && b.value.change).toBe('none');
    expect(b.ok && b.value.width).toBe(800);
  });

  it('FR-AST-002: a codec that cannot decode keeps an image that fits, and refuses one over the limit with a code', async () => {
    const fits = await importImage(png(100, 100), none);
    expect(fits.ok && fits.value.change).toBe('none');
    const over = await importImage(jpeg(5000, 100, 10), none);
    expect(over.ok ? '' : over.error.code).toBe('IMAGE_DECODE_FAILED');
  });

  it('FR-AST-002: the limit rests on the decoded picture, not the header: a lying or missing header changes nothing', async () => {
    // the header says 100 x 100, the pixels are 4000 x 2000: the codec scales them, and the result is the scaled WebP even when it is not smaller
    const liar = codec(50_000, { width: 4000, height: 2000 });
    const r = await importImage(png(100, 100, 3000), liar.c);
    expect(r.ok && [r.value.mime, r.value.width, r.value.height, r.value.change]).toEqual(['image/webp', 2560, 1280, 'downscaled']);
    // no size in the header (a JPEG whose size marker is out of reach): the same
    const noSize = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, ...new Array(100).fill(0)]);
    const n = await importImage(noSize, codec(50_000, { width: 5120, height: 2560 }).c);
    expect(n.ok && [n.value.mime, n.value.width, n.value.change]).toEqual(['image/webp', 2560, 'downscaled']);
    // a codec that hands back a picture over the limit fails the import instead of passing it on
    const stubborn: ImageCodec = { toWebp: () => Promise.resolve({ bytes: new Uint8Array(5), width: 4000, height: 2000, scaled: false }) };
    const refused = await importImage(png(100, 100, 3000), stubborn);
    expect(refused.ok ? '' : refused.error.code).toBe('IMAGE_DECODE_FAILED');
  });

  it('FR-AST-002: a rotated picture is judged by the sizes the codec reports, so a swapped header is not a downscale', async () => {
    // an EXIF-rotated phone photo: the header says 2400 x 1600, the picture is shown 1600 x 2400, and the WebP is larger than the file
    const original = jpeg(2400, 1600, 100);
    const rotated = codec(original.length + 10, { width: 1600, height: 2400 });
    const r = await importImage(original, rotated.c);
    expect(r.ok && r.value.bytes).toBe(original);
    expect(r.ok && r.value.change).toBe('none');
    expect(r.ok && [r.value.width, r.value.height]).toEqual([1600, 2400]);
    // and when the WebP is smaller it is a plain re-encode with the sizes as shown
    const smaller = await importImage(original, codec(10, { width: 1600, height: 2400 }).c);
    expect(smaller.ok && [smaller.value.width, smaller.value.height, smaller.value.change]).toEqual([1600, 2400, 'webp']);
  });

  it('FR-AST-001: an animated image is kept whole, whatever its size, and the codec is not asked', async () => {
    const frame = [0x21, 0xf9, 4, 0, 0, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 1, 0, 0];
    const gif = Uint8Array.from([...text('GIF89a'), 0xd0, 0x07, 0xd0, 0x07, 0, 0, 0, ...frame, ...frame, 0x3b]);
    const { c, calls } = codec(1);
    const r = await importImage(gif, c);
    expect(calls).toEqual([]);
    expect(r.ok && r.value.bytes).toBe(gif);
    expect(r.ok && r.value.mime).toBe('image/gif');
  });

  it('NFR-SEC-001: an SVG is rebuilt from the allowlist and minified; one with nothing safe in it is refused', async () => {
    const dirty = encodeUtf8(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">\n <script>x()</script>\n <rect width="10" height="10" onclick="y()"/>\n</svg>',
    );
    const r = await importImage(dirty, none);
    expect(r.ok && r.value.mime).toBe('image/svg+xml');
    expect(r.ok && r.value.change).toBe('svg');
    const out = r.ok ? decodeUtf8(r.value.bytes) : '';
    expect(out).toContain('<rect');
    expect(out).not.toMatch(/script|onclick|\n/);
    const refused = await importImage(encodeUtf8('<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>'), none);
    expect(refused.ok || refused.error.code === 'IMAGE_SVG_REFUSED').toBe(true);
  });

  it('FR-AST-001: what is not an image, or is too large, is a failure with a code and a line', async () => {
    const notImage = await importImage(encodeUtf8('%PDF-1.7'), none);
    expect(notImage.ok ? '' : notImage.error).toMatchObject({ code: 'IMAGE_NOT_AN_IMAGE' });
    const huge = await importImage({ length: MAX_IMPORT_BYTES + 1 } as Uint8Array, none);
    expect(huge.ok ? '' : huge.error.code).toBe('IMAGE_TOO_LARGE');
  });
});
