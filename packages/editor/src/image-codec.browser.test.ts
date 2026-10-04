import { importImage, sniffImage } from '@fluxion/format';
import { describe, expect, it } from 'vitest';
import { browserImageCodec } from './image-codec.js';

/** A photo-like image (noise over a gradient: it does not compress away) as a file of `type`. */
async function picture(width: number, height: number, type: 'image/jpeg' | 'image/png'): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#d33');
  gradient.addColorStop(1, '#36c');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = `hsl(${(i * 47) % 360} 70% 50%)`;
    ctx.fillRect((i * 7919) % width, (i * 104729) % height, 40, 40);
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.95));
  if (blob === null) throw new Error('the canvas made no image');
  return new Uint8Array(await blob.arrayBuffer());
}

describe('the browser image codec (FR-AST-002)', () => {
  it('FR-AST-002: a 4000 px JPEG imports as a WebP of at most 2560 px', async () => {
    const jpeg = await picture(4000, 2000, 'image/jpeg');
    expect(sniffImage(jpeg)).toMatchObject({ mime: 'image/jpeg', width: 4000, height: 2000 });
    const r = await importImage(jpeg, browserImageCodec);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.mime).toBe('image/webp');
    expect(r.value.change).toBe('downscaled');
    expect(r.value.width).toBe(2560);
    expect(r.value.height).toBe(1280);
    // the bytes are what they say: a WebP of that size, smaller than the 4000 px file
    expect(sniffImage(r.value.bytes)).toMatchObject({ mime: 'image/webp', width: 2560, height: 1280 });
    expect(r.value.bytes.length).toBeLessThan(jpeg.length);
  });

  it('FR-AST-002: a PNG within the limit becomes WebP when that is smaller, and stays PNG when it is not', async () => {
    const png = await picture(900, 600, 'image/png');
    const r = await importImage(png, browserImageCodec);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.bytes.length).toBeLessThanOrEqual(png.length);
    expect(sniffImage(r.value.bytes)).toMatchObject({ mime: r.value.mime, width: 900, height: 600 });
  });

  it('FR-AST-002: an EXIF-rotated JPEG keeps its proportions and reports the size it is shown at', async () => {
    const upright = await picture(600, 400, 'image/jpeg');
    // an APP1 Exif segment with orientation 6 (rotate 90 degrees clockwise) right after the start of image
    const exif = [0xff, 0xe1, 0, 34, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0];
    const rotated = Uint8Array.from([...upright.subarray(0, 2), ...exif, ...upright.subarray(2)]);
    expect(sniffImage(rotated)).toMatchObject({ mime: 'image/jpeg', width: 600, height: 400 });
    // a limit below the picture forces the scaling path: the long side of the picture as shown is the limit
    const r = await importImage(rotated, browserImageCodec, 300);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.change).toBe('downscaled');
    expect([r.value.width, r.value.height]).toEqual([200, 300]);
    expect(sniffImage(r.value.bytes)).toMatchObject({ mime: 'image/webp', width: 200, height: 300 });
  });

  it('FR-AST-001: what the browser cannot decode is undefined from the codec, not a throw', async () => {
    expect(await browserImageCodec.toWebp(new Uint8Array([1, 2, 3]), 'image/png', 2560)).toBeUndefined();
  });
});
