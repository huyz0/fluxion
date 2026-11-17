// Seed colours from an image (FR-THM-005, ADR-0055 §Image → palette): a box-average downscale to at most 64 px on the longest side,
// opaque pixels as OKLab points, k-means (k = 5, k-means++ from the seeded stream, at most 16 rounds), then up to three chromatic
// clusters by weight times chroma, each at least 30° in hue from those taken. Decoding is the caller's (the editor passes
// `ImageData`'s fields); this module only reads RGBA bytes. Deterministic for the same pixels and seed. Pure.
import { err, ok, type Result } from '@fluxion/schema';
import type { ThemeError } from './errors.js';
import { LIGHT_THEME } from './light.js';
import { type Oklch, oklchToCss, rgbToOklch } from './oklch.js';
import { createRng } from './rng.js';
import { isToken } from './tokens.js';

/**
 * Decoded RGBA pixels, row by row, four bytes a pixel (the fields of a DOM `ImageData`).
 *
 * @public
 */
export type PalettePixels = {
  /** Width in pixels, a whole number of at least 1. */
  readonly width: number;
  /** Height in pixels, a whole number of at least 1. */
  readonly height: number;
  /** `width * height * 4` bytes: red, green, blue and alpha of each pixel, 0 to 255. */
  readonly data: ArrayLike<number>;
};

/**
 * How seeds are drawn from an image.
 *
 * @public
 */
export type PixelPaletteOptions = {
  /** The k-means++ initialisation seed, a whole number 0 to 2^32 - 1 (default 0x5eed). */
  readonly seed?: number;
};

/** Longest side of the downscaled image, in pixels. */
const MAX_SIDE = 64;
/** The most pixels an image may have (16 Mpx). */
const MAX_PIXELS = 16_000_000;
const K = 5;
const MAX_ROUNDS = 16;
/** A pixel with less alpha than this is dropped. */
const MIN_ALPHA = 128;
/** A cluster with less OKLab chroma than this is not a seed. */
const MIN_CHROMA = 0.03;
/** The least hue gap between two seeds, in degrees. */
const MIN_HUE_GAP = 30;
const DEFAULT_SEED = 0x5eed;

/** A point in OKLab: lightness, a, b. */
export type Lab = readonly [number, number, number];

const input = (message: string): Result<never, ThemeError> => err({ code: 'PALETTE_INPUT', message });
const whole = (n: number, min: number, max: number): boolean => Number.isInteger(n) && n >= min && n <= max;
const dist2 = (p: Lab, q: Lab): number => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
const hueGap = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

/**
 * One to three seed colours (`#rrggbb`) for `generatePalette`, drawn from an image's pixels. Pixels with alpha under 128 are
 * dropped; an image with no cluster of chroma 0.03 or more gives one seed, the light theme's `primary`. Deterministic for the same
 * pixels and seed. `PALETTE_INPUT` when the size is not whole numbers of at least 1, there are more than 16 Mpx, `data` is not
 * `width * height * 4` bytes, or the seed is not a whole number 0 to 2^32 - 1.
 *
 * @public
 */
export function paletteFromPixels(pixels: PalettePixels, options: PixelPaletteOptions = {}): Result<readonly string[], ThemeError> {
  const { width, height, data } = pixels;
  if (!whole(width, 1, MAX_PIXELS) || !whole(height, 1, MAX_PIXELS)) return input('width and height are whole numbers of at least 1');
  if (width * height > MAX_PIXELS) return input('an image has at most 16 Mpx');
  if (data.length !== width * height * 4) return input('data is width * height * 4 bytes');
  const seed = options.seed ?? DEFAULT_SEED;
  if (!whole(seed, 0, 0xffffffff)) return input('seed is a whole number 0 to 2^32 - 1');

  const points = opaquePoints(downscaled(pixels));
  if (points.length === 0) return ok([fallbackSeed()]);
  const clusters = kMeans(points, Math.min(K, points.length), createRng(seed));
  const seeds = pickSeeds(clusters, points.length);
  return ok(seeds.length > 0 ? seeds.map(oklchToCss) : [fallbackSeed()]);
}

/** RGBA pixels box-averaged to at most {@link MAX_SIDE} on the longest side, aspect kept; colour weighted by alpha. */
function downscaled({ width, height, data }: PalettePixels): PalettePixels {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const [w, h] = [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
  if (w === width && h === height) return { width, height, data };
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const [y0, y1] = [Math.floor((y * height) / h), Math.floor(((y + 1) * height) / h)];
    for (let x = 0; x < w; x++) {
      const [x0, x1] = [Math.floor((x * width) / w), Math.floor(((x + 1) * width) / w)];
      const sum = boxSum(data, width, { x0, x1, y0, y1 });
      const at = (y * w + x) * 4;
      if (sum.alpha > 0) for (let i = 0; i < 3; i++) out[at + i] = Math.round((sum.rgb[i] as number) / sum.alpha);
      out[at + 3] = Math.round(sum.alpha / sum.count);
    }
  }
  return { width: w, height: h, data: out };
}

/** The alpha-weighted channel sums, alpha sum and pixel count of a source box. */
function boxSum(data: ArrayLike<number>, width: number, { x0, x1, y0, y1 }: { x0: number; x1: number; y0: number; y1: number }) {
  const rgb = [0, 0, 0];
  let [alpha, count] = [0, 0];
  for (let sy = y0; sy < y1; sy++) {
    for (let sx = x0; sx < x1; sx++) {
      const i = (sy * width + sx) * 4;
      const a = data[i + 3] as number;
      for (let c = 0; c < 3; c++) rgb[c] = (rgb[c] as number) + (data[i + c] as number) * a;
      alpha += a;
      count++;
    }
  }
  return { rgb, alpha, count };
}

/** The pixels with alpha of at least {@link MIN_ALPHA}, as OKLab points in row order. */
function opaquePoints({ data, width, height }: PalettePixels): Lab[] {
  const points: Lab[] = [];
  for (let i = 0; i < width * height * 4; i += 4) {
    if ((data[i + 3] as number) < MIN_ALPHA) continue;
    const { l, c, h } = rgbToOklch((data[i] as number) / 255, (data[i + 1] as number) / 255, (data[i + 2] as number) / 255);
    points.push([l, c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)]);
  }
  return points;
}

/** A k-means cluster: its centroid and how many points it holds. */
export type Cluster = { readonly centroid: Lab; readonly size: number };

/** The index of the centre nearest `p` (the lowest index on a tie). Module-internal: exported for the tie-break test. */
export function nearest(p: Lab, centres: readonly Lab[]): number {
  let [best, bestD] = [0, Number.POSITIVE_INFINITY];
  centres.forEach((c, i) => {
    const d = dist2(p, c);
    if (d < bestD) [best, bestD] = [i, d];
  });
  return best;
}

/** k-means++ initial centres: the first uniformly, each next with probability proportional to its squared distance. */
function initialCentres(points: readonly Lab[], k: number, rng: () => number): Lab[] {
  const centres: Lab[] = [points[Math.floor(rng() * points.length)] as Lab];
  while (centres.length < k) {
    const d = points.map((p) => dist2(p, centres[nearest(p, centres)] as Lab));
    const total = d.reduce((s, v) => s + v, 0);
    centres.push(points[total === 0 ? centres.length % points.length : weightedPick(d, rng() * total)] as Lab);
  }
  return centres;
}

/** The index where the running sum of `weights` first passes `r` (the last index when rounding leaves none). */
function weightedPick(weights: readonly number[], r: number): number {
  let left = r;
  for (let i = 0; i < weights.length; i++) {
    left -= weights[i] as number;
    if (left < 0) return i;
  }
  return weights.length - 1;
}

/** Lloyd's k-means from k-means++ centres. */
function kMeans(points: readonly Lab[], k: number, rng: () => number): Cluster[] {
  return lloyd(points, initialCentres(points, k, rng)).clusters;
}

/**
 * Lloyd's iteration from `centres`: at most {@link MAX_ROUNDS} assignment rounds, stopping early when no assignment changes; each
 * cluster's centroid and size, and the rounds run. Module-internal: exported for the k-means rule tests.
 */
export function lloyd(points: readonly Lab[], start: readonly Lab[]): { clusters: Cluster[]; rounds: number } {
  let centres = [...start];
  let assign: number[] = [];
  let rounds = 0;
  while (rounds < MAX_ROUNDS) {
    rounds++;
    const next = points.map((p) => nearest(p, centres));
    const changed = next.some((a, i) => a !== assign[i]);
    assign = next;
    if (!changed) break;
    centres = centroids(points, assign, centres);
  }
  return { clusters: centres.map((centroid, i) => ({ centroid, size: assign.filter((a) => a === i).length })), rounds };
}

/** The mean of each cluster's points; an empty cluster takes the point farthest from its own centre. */
function centroids(points: readonly Lab[], assign: readonly number[], old: readonly Lab[]): Lab[] {
  const sums = old.map(() => [0, 0, 0, 0]);
  points.forEach((p, i) => {
    const s = sums[assign[i] as number] as number[];
    for (let c = 0; c < 3; c++) s[c] = (s[c] as number) + (p[c] as number);
    s[3] = (s[3] as number) + 1;
  });
  return sums.map(([l, a, b, n]) => {
    if (n === 0) return farthest(points, assign, old);
    return [(l as number) / (n as number), (a as number) / (n as number), (b as number) / (n as number)] as const;
  });
}

/** The point farthest from the centre it is assigned to (the first on a tie). */
function farthest(points: readonly Lab[], assign: readonly number[], centres: readonly Lab[]): Lab {
  let [best, bestD] = [0, -1];
  points.forEach((p, i) => {
    const d = dist2(p, centres[assign[i] as number] as Lab);
    if (d > bestD) [best, bestD] = [i, d];
  });
  return points[best] as Lab;
}

const chroma = ({ centroid: [, a, b] }: Cluster): number => Math.hypot(a, b);
const hueOf = ({ centroid: [, a, b] }: Cluster): number => ((((Math.atan2(b, a) * 180) / Math.PI) % 360) + 360) % 360;

/** Up to three chromatic clusters by weight times chroma (lowest index on a tie), each 30° or more in hue from those before. */
function pickSeeds(clusters: readonly Cluster[], total: number): Oklch[] {
  const ranked = clusters
    .map((cluster, index) => ({ cluster, index, score: (cluster.size / total) * chroma(cluster) }))
    .filter(({ cluster }) => cluster.size > 0 && chroma(cluster) >= MIN_CHROMA)
    .sort((x, y) => y.score - x.score || x.index - y.index);
  const taken: Cluster[] = [];
  for (const { cluster } of ranked) {
    if (taken.length === 3) break;
    if (taken.every((t) => hueGap(hueOf(t), hueOf(cluster)) >= MIN_HUE_GAP)) taken.push(cluster);
  }
  return taken.map((cluster) => ({ l: cluster.centroid[0], c: chroma(cluster), h: hueOf(cluster), alpha: 1 }));
}

/** The light theme's `primary` colour, the seed of an image with no chromatic cluster. */
function fallbackSeed(): string {
  const color = LIGHT_THEME.tokens['color'];
  const primary = color !== undefined && !isToken(color) ? color['primary'] : undefined;
  return primary !== undefined && isToken(primary) ? String(primary.$value) : '#2563eb';
}
