// FR-THM-005 (ADR-0055 §Image → palette): seeds from an image's pixels — determinism, the AA pairs of the palette they give,
// PALETTE_INPUT, transparency, the grey fallback, the hue gap between seeds and the downscale.
import { describe, expect, it } from 'vitest';
import { PALETTE_CONTRAST_PAIRS } from './contrast.js';
import { contrastRatio, oklchToCss, parseColor } from './oklch.js';
import { generatePalette, type Palette } from './palette.js';
import { type Lab, lloyd, nearest, type PalettePixels, paletteFromPixels } from './palette-image.js';

type Rgba = readonly [number, number, number, number];

/** A width × height image painted by `at(x, y)`, with a fixed ±`amount` per channel grain from an LCG (default 6) so clusters are not single points. */
function image(width: number, height: number, at: (x: number, y: number) => Rgba, amount = 6): PalettePixels {
  const data = new Uint8ClampedArray(width * height * 4);
  let s = 12345;
  const grain = () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return amount === 0 ? 0 : ((s >>> 16) % (2 * amount + 1)) - amount;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = at(x, y);
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) data[i + c] = (px[c] as number) + grain();
      data[i + 3] = px[3];
    }
  }
  return { width, height, data };
}

/** The fixture: a 320 × 200 poster — a blue field, an orange band, a green badge, a grey margin and a transparent corner. */
const FIXTURE = image(320, 200, (x, y) => {
  if (x < 40 && y < 40) return [255, 0, 255, 0];
  if (x < 24 || x >= 296) return [128, 128, 128, 255];
  if (y >= 150) return [234, 88, 12, 255];
  if ((x - 240) ** 2 + (y - 60) ** 2 < 30 ** 2) return [22, 163, 74, 255];
  return [37, 99, 235, 255];
});

const seedsOf = (pixels: PalettePixels, seed?: number): readonly string[] => {
  const result = paletteFromPixels(pixels, seed === undefined ? {} : { seed });
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
};
const paletteOf = (pixels: PalettePixels): Palette => {
  const result = generatePalette({ seeds: seedsOf(pixels) });
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
};
const code = (pixels: PalettePixels, seed?: number): string => {
  const result = paletteFromPixels(pixels, seed === undefined ? {} : { seed });
  return result.ok ? 'ok' : result.error.code;
};
const rgbOf = (hex: string): Rgba => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).concat(255) as unknown as Rgba;
const lch = (hex: string) => parseColor(hex) as NonNullable<ReturnType<typeof parseColor>>;
const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
const solid = (rgba: Rgba, width = 8, height = 8): PalettePixels => ({
  width,
  height,
  data: Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => rgba[i % 4] as number),
});

describe('paletteFromPixels (FR-THM-005)', () => {
  it('FR-THM-005: a fixture image gives the same palette twice', () => {
    const first = seedsOf(FIXTURE);
    expect(seedsOf(FIXTURE)).toEqual(first);
    expect(paletteOf(FIXTURE)).toEqual(paletteOf(FIXTURE));
    // the poster's three colours, largest weighted chroma first: the blue field, the orange band, the green badge
    // (the grain averages out: each seed is its region's paint to within a unit per channel; exact in Node, ADR-0055)
    expect(first).toEqual(['#2563eb', '#ea580c', '#16a24e']);
  });

  it('FR-THM-005: an image palette holds its AA pairs', () => {
    const palette = paletteOf(FIXTURE);
    expect(palette.unmet).toEqual([]);
    for (const { role, against, target } of PALETTE_CONTRAST_PAIRS) {
      expect(contrastRatio(palette.colors[role], palette.colors[against]), `${role} on ${against}`).toBeGreaterThanOrEqual(target);
    }
    expect(palette.colors.primary).toBe(seedsOf(FIXTURE)[0]);
  });

  it('FR-THM-005: the same pixels and seed give the same seeds; the k-means seed is part of the input', () => {
    for (const seed of [0, 1, 0x5eed, 0xffffffff]) expect(seedsOf(FIXTURE, seed)).toEqual(seedsOf(FIXTURE, seed));
    expect(seedsOf(FIXTURE, 0x5eed)).toEqual(seedsOf(FIXTURE));
    // a hue wheel has no natural clusters, so where k-means++ starts decides the seeds
    const wheel = image(64, 16, (x) => rgbOf(oklchToCss({ l: 0.65, c: 0.13, h: (x / 64) * 360, alpha: 1 })), 0);
    expect(seedsOf(wheel, 0)).not.toEqual(seedsOf(wheel, 1));
    expect(seedsOf(wheel, 0x5eed)).toEqual(seedsOf(wheel));
  });

  it('FR-THM-005: seeds rank by area times chroma, not by area or chroma alone', () => {
    // a dull teal over 60% (C 0.05) against a vivid red over 30% (C 0.2): the red leads
    const dullBig = image(100, 20, (x) => (x < 60 ? rgbOf('#5d8a87') : x < 90 ? rgbOf('#de3b3d') : [128, 128, 128, 255]), 0);
    expect(hueGap(lch(seedsOf(dullBig)[0] as string).h, lch('#de3b3d').h)).toBeLessThan(5);
    // a mid blue over 60% (C 0.12) against a vivid magenta over 5% (C 0.3): the blue leads
    const vividSmall = image(100, 20, (x) => (x < 60 ? rgbOf('#3d73b6') : x < 65 ? rgbOf('#d100cb') : [128, 128, 128, 255]), 0);
    expect(hueGap(lch(seedsOf(vividSmall)[0] as string).h, lch('#3d73b6').h)).toBeLessThan(5);
  });

  it('FR-THM-005: seeds are chromatic and at least 30 degrees apart in hue', () => {
    // two blues 12° apart and an orange: the second blue is skipped
    const pixels = image(90, 30, (x) => (x < 40 ? [37, 99, 235, 255] : x < 70 ? [79, 70, 229, 255] : [234, 88, 12, 255]));
    const seeds = seedsOf(pixels).map(lch);
    expect(seeds).toHaveLength(2);
    expect(hueGap(seeds[0]?.h as number, seeds[1]?.h as number)).toBeGreaterThanOrEqual(30);
    for (const s of seeds) expect(s.c).toBeGreaterThanOrEqual(0.03);
  });

  it('FR-THM-005: two hues 40 degrees apart are both seeds; 22 degrees apart, the second is dropped', () => {
    const pair = (a: string, b: string) => seedsOf(image(40, 10, (x) => (x < 24 ? rgbOf(a) : rgbOf(b)), 0)).map((h) => Math.round(lch(h).h));
    const hue = (hex: string) => Math.round(lch(hex).h);
    // OKLCH L 0.6 C 0.15 at hues 250, 290 and 272
    expect(pair('#2784d5', '#816dd2')).toEqual([hue('#2784d5'), hue('#816dd2')]);
    expect(pair('#2784d5', '#6277d9')).toEqual([hue('#2784d5')]);
    expect(hueGap(hue('#2784d5'), hue('#816dd2'))).toBeGreaterThan(35);
    expect(hueGap(hue('#2784d5'), hue('#6277d9'))).toBeLessThan(25);
  });

  it('FR-THM-005: a cluster of chroma 0.03 or more is a seed; under it is grey', () => {
    // OKLCH L 0.8 hue 80 at C 0.04 and C 0.02
    expect(hueGap(lch(seedsOf(solid(rgbOf('#cbbba1')))[0] as string).h, 80)).toBeLessThan(3);
    expect(seedsOf(solid(rgbOf('#c5bdb0')))).toEqual(['#2563eb']);
  });

  it('FR-THM-005: a grey or fully transparent image gives one seed, the light theme primary', () => {
    expect(seedsOf(solid([128, 128, 128, 255]))).toEqual(['#2563eb']);
    expect(seedsOf(solid([255, 0, 0, 127]))).toEqual(['#2563eb']);
    expect(generatePalette({ seeds: seedsOf(solid([0, 0, 0, 0])) }).ok).toBe(true);
  });

  it('FR-THM-005: pixels under alpha 128 are dropped', () => {
    // a red image whose left half is a transparent green: only red is seen
    const pixels = image(64, 16, (x) => (x < 32 ? [22, 163, 74, 100] : [220, 38, 38, 255]));
    const seeds = seedsOf(pixels).map(lch);
    expect(seeds).toHaveLength(1);
    expect(hueGap(seeds[0]?.h as number, lch('#dc2626').h)).toBeLessThan(10);
    // alpha 128 is kept, 127 is not
    expect(seedsOf(solid([220, 38, 38, 128]))).toEqual(['#dc2626']);
    expect(seedsOf(solid([220, 38, 38, 127]))).toEqual(['#2563eb']);
  });

  it('FR-THM-005: a large image is box-averaged first: the result follows its colour areas, not its pixel count', () => {
    const big = image(1000, 500, (x) => (x < 700 ? [37, 99, 235, 255] : [234, 88, 12, 255]));
    const small = image(100, 50, (x) => (x < 70 ? [37, 99, 235, 255] : [234, 88, 12, 255]));
    const [b, s] = [seedsOf(big).map(lch), seedsOf(small).map(lch)];
    expect(b.map((c) => Math.round(c.h / 10))).toEqual(s.map((c) => Math.round(c.h / 10)));
    // a one-pixel-high strip keeps its aspect and still reads
    expect(seedsOf(solid([234, 88, 12, 255], 5000, 1))).toHaveLength(1);
  });

  it('FR-THM-005: PALETTE_INPUT for a bad size, too many pixels, a wrong byte count or a bad seed', () => {
    expect(code({ width: 0, height: 4, data: [] })).toBe('PALETTE_INPUT');
    expect(code({ width: 2.5, height: 4, data: new Uint8Array(40) })).toBe('PALETTE_INPUT');
    expect(code({ width: 4001, height: 4000, data: { length: 4001 * 4000 * 4 } as ArrayLike<number> })).toBe('PALETTE_INPUT');
    expect(code({ width: 4000, height: 4000, data: { length: 4000 * 4000 * 4 - 1 } as ArrayLike<number> })).toBe('PALETTE_INPUT');
    expect(code({ width: 2, height: 2, data: new Uint8Array(15) })).toBe('PALETTE_INPUT');
    expect(code(solid([1, 2, 3, 255]), -1)).toBe('PALETTE_INPUT');
    expect(code(solid([1, 2, 3, 255]), 2 ** 32)).toBe('PALETTE_INPUT');
    expect(code(solid([1, 2, 3, 255]), 1.5)).toBe('PALETTE_INPUT');
    expect(code(solid([1, 2, 3, 255]))).toBe('ok');
  });
});

describe('k-means rules (FR-THM-005, ADR-0055)', () => {
  const line = (n: number): Lab[] => Array.from({ length: n }, (_, i) => [i / n, 0, 0] as const);

  it('FR-THM-005: a point equally near two centres goes to the lower index', () => {
    expect(
      nearest(
        [0.5, 0, 0],
        [
          [0, 0, 0],
          [1, 0, 0],
        ],
      ),
    ).toBe(0);
    expect(
      nearest(
        [0.5, 0, 0],
        [
          [1, 0, 0],
          [0, 0, 0],
        ],
      ),
    ).toBe(0);
    expect(
      nearest(
        [0.6, 0, 0],
        [
          [0, 0, 0],
          [1, 0, 0],
        ],
      ),
    ).toBe(1);
  });

  it('FR-THM-005: an empty cluster takes the point farthest from its own centre', () => {
    // centres 0 and 1 coincide: centre 1 gets no point in the first round and restarts at 0.1, the point farthest from its centre
    const { clusters } = lloyd(
      [
        [0, 0, 0],
        [0.1, 0, 0],
        [1, 0, 0],
      ],
      [
        [0, 0, 0],
        [0, 0, 0],
        [1, 0, 0],
      ],
    );
    expect(clusters.map((c) => c.size)).toEqual([1, 1, 1]);
    expect(clusters.map((c) => c.centroid[0])).toEqual([0, 0.1, 1]);
  });

  it('FR-THM-005: k-means stops when no assignment changes, and after 16 rounds at most', () => {
    expect(
      lloyd(line(100), [
        [0, 0, 0],
        [0.001, 0, 0],
      ]).rounds,
    ).toBe(8);
    expect(
      lloyd(
        line(1600),
        Array.from({ length: 5 }, (_, j) => [j * 0.001, 0, 0] as const),
      ).rounds,
    ).toBe(16);
  });
});
