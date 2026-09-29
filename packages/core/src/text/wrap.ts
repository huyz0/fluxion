// Text broken into lines by words (ADR-0018 item 3, FR-SHP-006), measured through the TextMeasurer
// port (FR-TXT-002: one measurement path for every host). A word wider than the line stands alone.
import type { FontSpec, TextMeasurer } from '../ports/ports.js';

/**
 * Lines of text and their size.
 *
 * @public
 */
export type WrappedText = {
  /** The lines, in order (an empty paragraph is an empty line). */
  readonly lines: readonly string[];
  /** Width of the widest line, in px. */
  readonly width: number;
  /** Height of all lines, in px (0 without lines). */
  readonly height: number;
};

/** One paragraph's lines: words joined while they fit `maxWidth`. */
function paragraphLines(paragraph: string, maxWidth: number, width: (text: string) => number): string[] {
  // tzap disable next-line Regex: split on one space or on a run of them, the empty words are dropped alike
  const [first, ...rest] = paragraph.split(/\s+/).filter((w) => w !== '');
  if (first === undefined) return [''];
  const lines: string[] = [];
  let line = first;
  for (const word of rest) {
    const candidate = `${line} ${word}`;
    if (width(candidate) <= maxWidth) line = candidate;
    else {
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  return lines;
}

/**
 * `paragraphs` broken into lines no wider than `maxWidth` where words allow, set in `font`.
 *
 * @public
 */
export function wrapText(paragraphs: readonly string[], font: FontSpec, maxWidth: number, measurer: TextMeasurer): WrappedText {
  const width = (text: string) => measurer.measure(text, font).width;
  const lines = paragraphs.flatMap((p) => paragraphLines(p, maxWidth, width));
  if (lines.length === 0) return { lines, width: 0, height: 0 };
  const size = measurer.measure(lines.join('\n'), font);
  return { lines, width: size.width, height: size.height };
}
