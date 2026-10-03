// The metrics producer for a font a user brings or the studio fetches (FR-THM-008, ADR-0148, ADR-0022): the same recording as
// scripts/fonts/record-metrics.mjs, run in the page that will draw the text. It loads the bytes as a face of its own, measures in
// the DOM at 1000 px every character, every two-character sequence and every three-letter sequence (what kerning and ligatures add
// to the sum of their parts), and returns the `FaceMetrics` a metrics measurer adds up. An editor host tool: the player never
// records anything (it takes the metrics a document carries).
import type { FaceMetrics } from '@fluxion/core';

/**
 * The face to record: the family, weight and style the document will name it by.
 *
 * @public
 */
export type RecordedFace = {
  /** The family name (not the one the bytes carry: the one the document uses). */
  readonly family: string;
  /** CSS weight. */
  readonly weight: number;
  /** CSS style. */
  readonly style: 'normal' | 'italic';
};

const UNITS = 1000;
const ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');
const TYPOGRAPHY = '–—‘’“”•…€™';
const LATIN1 = Array.from({ length: 64 }, (_, i) => String.fromCharCode(0xc0 + i)).join('');
/** Pairs are recorded among the first two sets; every set has an advance. */
const PAIRED = ASCII + TYPOGRAPHY;
const ALPHABET = PAIRED + LATIN1;
/** The letters ligatures are made of: three-letter sequences are recorded for these. */
const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

const round = (n: number): number => Math.round(n * 100) / 100;
let recordings = 0;

/** The width the DOM gives each of `texts` set in the CSS `font`, all in one layout. */
function widthsOf(texts: readonly string[], font: string): number[] {
  const box = document.createElement('div');
  box.style.cssText = `position:absolute;left:0;top:0;white-space:pre;line-height:1.2;text-rendering:geometricPrecision;font:${font}`;
  const spans = texts.map((text) => {
    const span = document.createElement('span');
    span.style.cssText = 'display:block;width:max-content';
    span.textContent = text;
    box.append(span);
    return span;
  });
  document.body.append(box);
  const widths = spans.map((span) => span.getBoundingClientRect().width);
  box.remove();
  return widths;
}

/** Every sequence of `size` characters taken from `characters`. */
function sequences(characters: string, size: number): string[] {
  const chars = [...characters];
  let out = [''];
  for (let i = 0; i < size; i++) out = out.flatMap((prefix) => chars.map((c) => prefix + c));
  return out;
}

/** What `measured` adds beyond `parts`, when it adds anything the table keeps (more than half a unit). */
const addedBeyond = (measured: number, parts: number): number | undefined => (Math.abs(measured - parts) > 0.5 ? measured - parts : undefined);

type Table = { [key: string]: number };

/** The advance of each character of `alphabet`. */
function recordAdvances(font: string): Table {
  const chars = [...ALPHABET];
  const widths = widthsOf(chars, font);
  return Object.fromEntries(chars.map((c, i) => [c, widths[i] as number]));
}

/** What every two-character sequence of the paired set adds to its two advances. */
function recordPairs(advances: Table, font: string): Table {
  const list = sequences(PAIRED, 2);
  const widths = widthsOf(list, font);
  const pairs: Table = {};
  list.forEach((ab, i) => {
    const [a, b] = [...ab] as [string, string];
    const added = addedBeyond(widths[i] as number, (advances[a] as number) + (advances[b] as number));
    if (added !== undefined) pairs[ab] = added;
  });
  return pairs;
}

/** What every three-letter sequence adds to its three advances and its two pairs. */
function recordTriples(advances: Table, pairs: Table, font: string): Table {
  const list = sequences(LETTERS, 3);
  const widths = widthsOf(list, font);
  const triples: Table = {};
  list.forEach((abc, i) => {
    const [a, b, c] = [...abc] as [string, string, string];
    const parts = (advances[a] as number) + (advances[b] as number) + (advances[c] as number) + (pairs[a + b] ?? 0) + (pairs[b + c] ?? 0);
    const added = addedBeyond(widths[i] as number, parts);
    if (added !== undefined) triples[abc] = added;
  });
  return triples;
}

const rounded = (table: Table): Table => Object.fromEntries(Object.entries(table).map(([k, v]) => [k, round(v)]));

/**
 * The metrics of the font in `bytes`, recorded in this page's DOM and named `face`. Rejects when the browser cannot load the bytes
 * as a font. The face is loaded under a name of its own for the recording and removed again.
 *
 * @public
 */
export async function recordFaceMetrics(bytes: Uint8Array, face: RecordedFace): Promise<FaceMetrics> {
  recordings++;
  const alias = `fx-recording-${recordings}`;
  const loaded = new FontFace(alias, bytes.slice().buffer, { weight: String(face.weight), style: face.style });
  await loaded.load();
  document.fonts.add(loaded);
  try {
    const font = `${face.style} ${face.weight} ${UNITS}px/1.2 "${alias}"`;
    const advances = recordAdvances(font);
    const pairs = recordPairs(advances, font);
    const triples = recordTriples(advances, pairs, font);
    return {
      family: face.family,
      weight: face.weight,
      style: face.style,
      unitsPerEm: UNITS,
      advances: rounded(advances),
      defaultAdvance: round(advances['?'] as number),
      pairs: rounded(pairs),
      triples: rounded(triples),
    };
  } finally {
    document.fonts.delete(loaded);
  }
}
