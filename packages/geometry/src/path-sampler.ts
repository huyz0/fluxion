import { type CubicSegment, derivativeAt, type Path, pointAt } from './path.js';
import { distance, normalize, type Vec2 } from './vec2.js';

/**
 * Options for {@link createPathSampler}.
 *
 * @public
 */
export type PathSamplerOptions = {
  /** Chords per segment in the arc-length table (default 64; higher is more accurate). */
  readonly samplesPerSegment?: number;
};

/**
 * Arc-length parameterisation of a {@link Path}.
 *
 * @public
 */
export type PathSampler = {
  /** Total (approximate) length of the path. */
  readonly length: number;
  /** Point at arc length `s`, clamped to `[0, length]`. */
  pointAtLength(s: number): Vec2;
  /** Unit tangent at arc length `s` (clamped); zero where the curve is degenerate. */
  tangentAtLength(s: number): Vec2;
  /** Point at fraction `f` of the total length, clamped to `[0, 1]`. */
  pointAtFraction(f: number): Vec2;
};

/** One chord of the arc-length table. */
type Chord = {
  readonly seg: CubicSegment;
  readonly t0: number;
  readonly t1: number;
  readonly s0: number;
  readonly s1: number;
};

const DEFAULT_SAMPLES = 64;
const ORIGIN: Vec2 = { x: 0, y: 0 };

function buildChords(path: Path, samples: number): readonly Chord[] {
  const chords: Chord[] = [];
  let total = 0;
  for (const seg of path.segments) {
    let prev = seg.p0;
    for (let k = 1; k <= samples; k++) {
      const t1 = k / samples;
      const p = pointAt(seg, t1);
      const s1 = total + distance(prev, p);
      chords.push({ seg, t0: (k - 1) / samples, t1, s0: total, s1 });
      total = s1;
      prev = p;
    }
  }
  return chords;
}

/** Index of the first chord whose end length is ≥ `s` (binary search). */
function findChord(chords: readonly Chord[], s: number): number {
  let lo = 0;
  let hi = chords.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((chords[mid]?.s1 ?? 0) < s) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Builds an arc-length lookup table for `path`. An empty path has length 0 and samples to the origin.
 *
 * @public
 */
export function createPathSampler(path: Path, options: PathSamplerOptions = {}): PathSampler {
  const samples = Math.max(1, Math.floor(options.samplesPerSegment ?? DEFAULT_SAMPLES));
  const chords = buildChords(path, samples);
  const total = chords.at(-1)?.s1 ?? 0;
  const locate = (s: number): { seg: CubicSegment; t: number } | null => {
    const chord = chords[findChord(chords, Math.min(Math.max(s, 0), total))];
    if (chord === undefined) return null;
    const span = chord.s1 - chord.s0;
    const k = span > 0 ? (Math.min(Math.max(s, chord.s0), chord.s1) - chord.s0) / span : 0;
    return { seg: chord.seg, t: chord.t0 + (chord.t1 - chord.t0) * k };
  };
  const pointAtLength = (s: number): Vec2 => {
    const at = locate(s);
    return at === null ? ORIGIN : pointAt(at.seg, at.t);
  };
  return {
    length: total,
    pointAtLength,
    tangentAtLength: (s: number): Vec2 => {
      const at = locate(s);
      return at === null ? ORIGIN : normalize(derivativeAt(at.seg, at.t));
    },
    pointAtFraction: (f: number): Vec2 => pointAtLength(Math.min(Math.max(f, 0), 1) * total),
  };
}
