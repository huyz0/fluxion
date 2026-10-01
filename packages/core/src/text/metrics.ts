// Text measured from recorded font metrics (FR-TXT-002, ADR-0148): the same numbers in the editor, the
// player, layout and the exporters. A face's metrics are its advance widths per character and the
// adjustment of each pair that the font's shaping changes (kerning, ligatures), recorded from the
// engine that draws the text (scripts/fonts/record-metrics.mjs); a host with no DOM measures a line by
// adding them up. A sequence of three letters (a ligature such as ffi) adds what it changes beyond its parts. A font with no metrics is measured by the fallback measurer. Pure: no canvas, no
// files, no clock.
import type { FontSpec, TextMeasurer, TextMetrics } from '../ports/ports.js';

/**
 * The metrics of one font face.
 *
 * @public
 */
export type FaceMetrics = {
  /** The family name as CSS writes it unquoted (`Roboto`); matched without regard to case. */
  readonly family: string;
  /** CSS weight of the face. */
  readonly weight: number;
  /** CSS style of the face. */
  readonly style: 'normal' | 'italic';
  /** The size, in px, the numbers below were recorded at: a width is `units / unitsPerEm * size`. */
  readonly unitsPerEm: number;
  /** The advance of each character (one code point per key), in units. */
  readonly advances: { readonly [character: string]: number };
  /** The advance of a character with none recorded, in units. */
  readonly defaultAdvance: number;
  /** The adjustment of each two-character sequence the font's shaping changes (kerning, a two-letter ligature), in units; zero ones are left out. */
  readonly pairs: { readonly [pair: string]: number };
  /** The adjustment of each three-letter sequence beyond its parts and its two pairs (a ligature such as `ffi`), in units; zero ones are left out. */
  readonly triples: { readonly [triple: string]: number };
};

/**
 * A set of recorded faces, as the metrics files hold them.
 *
 * @public
 */
export type FontMetricsFile = {
  /** The faces. */
  readonly faces: readonly FaceMetrics[];
};

const isRecord = (v: unknown): v is { readonly [key: string]: unknown } => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumbers = (v: unknown): v is { readonly [key: string]: number } => isRecord(v) && Object.values(v).every((n) => Number.isFinite(n));

/** The face in `v`, or undefined when it is not one. */
function readFace(v: unknown): FaceMetrics | undefined {
  if (!isRecord(v)) return undefined;
  const { family, weight, style, unitsPerEm, advances, defaultAdvance, pairs, triples = {} } = v;
  if (typeof family !== 'string' || family === '' || typeof weight !== 'number' || !Number.isFinite(weight)) return undefined;
  if (style !== 'normal' && style !== 'italic') return undefined;
  if (typeof unitsPerEm !== 'number' || !(unitsPerEm > 0) || !Number.isFinite(unitsPerEm)) return undefined;
  if (typeof defaultAdvance !== 'number' || !Number.isFinite(defaultAdvance) || !isNumbers(advances) || !isNumbers(pairs) || !isNumbers(triples))
    return undefined;
  return { family, weight, style, unitsPerEm, advances, defaultAdvance, pairs, triples };
}

/**
 * The faces in a metrics file's parsed JSON; a face that is not well formed is left out, so a damaged
 * or newer file measures what it can.
 *
 * @public
 */
export function readFontMetrics(json: unknown): FontMetricsFile {
  // tzap disable next-line ArrayDeclaration: anything in the list that is no face is dropped, so an empty list and a list of junk are one
  const faces = isRecord(json) && Array.isArray(json['faces']) ? json['faces'] : [];
  return { faces: faces.flatMap((f) => readFace(f) ?? []) };
}

/** The first family of a CSS `font-family` list, unquoted. */
function firstFamily(list: string): string {
  // tzap disable next-line StringLiteral: split always yields a first item
  const first = (list.split(',')[0] ?? '').trim();
  // tzap disable next-line Regex: text around a quoted name leaves a name no face has, as it does without the anchors
  return first.replace(/^(["'])(.*)\1$/, '$2');
}

/** The face that best matches `font`: its family, then its style, then the nearest weight (the heavier on a tie). */
function pickFace(faces: readonly FaceMetrics[], font: FontSpec): FaceMetrics | undefined {
  const family = firstFamily(font.family).toLowerCase();
  const same = faces.filter((f) => f.family.toLowerCase() === family);
  const style = font.style === 'italic' ? 'italic' : 'normal';
  const ofStyle = same.filter((f) => f.style === style);
  const pool = ofStyle.length > 0 ? ofStyle : same;
  const weight = font.weight ?? 400;
  let best: FaceMetrics | undefined;
  for (const f of pool) {
    if (best === undefined) best = f;
    else {
      const [d, bd] = [Math.abs(f.weight - weight), Math.abs(best.weight - weight)];
      // tzap disable next-line EqualityOperator: faces of one weight are one choice, the first
      if (d < bd || (d === bd && f.weight > best.weight)) best = f;
    }
  }
  return best;
}

/** The width of `line` in `face`, in px at `size`. */
function lineWidth(line: string, face: FaceMetrics, size: number): number {
  let units = 0;
  // the two characters before the current one
  // the first characters have none, and a key made of what is not a character is no key
  // tzap disable next-line StringLiteral
  let [before, previous] = ['', ''];
  for (const ch of line) {
    units += face.advances[ch] ?? face.defaultAdvance;
    units += (face.pairs[previous + ch] ?? 0) + (face.triples[before + previous + ch] ?? 0);
    [before, previous] = [previous, ch];
  }
  return (units / face.unitsPerEm) * size;
}

/**
 * A measurer that adds up the recorded metrics of `faces`, and asks `fallback` for a font none of them
 * matches. Lines are split at `\\n`; the height is the lines at the font's line height (1.2 when
 * omitted), the ascent 0.8 and the descent 0.2 of the size, as the canvas measurer answers them, so the
 * two agree in every number.
 *
 * @public
 */
export function createMetricsMeasurer(faces: readonly FaceMetrics[], fallback: TextMeasurer): TextMeasurer {
  return {
    measure(text: string, font: FontSpec): TextMetrics {
      const face = pickFace(faces, font);
      if (face === undefined) return fallback.measure(text, font);
      const lines = text.split('\n');
      return {
        width: Math.max(...lines.map((line) => lineWidth(line, face, font.size))),
        height: lines.length * (font.lineHeight ?? 1.2) * font.size,
        ascent: 0.8 * font.size,
        descent: 0.2 * font.size,
      };
    },
  };
}
