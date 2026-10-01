// Text laid out as it is drawn (FR-TXT-002, FR-SHP-006, M7.29): blocks of runs, each run with its own
// size, weight, style and family, a heading's scale, a block's own line height and the space around it,
// and a list's indent. The lines break at words as the plain wrap does (ADR-0018 item 3); a line is
// measured as the pieces of one font it is made of (so kerning inside a piece is the measurer's), and a
// line is as tall as its tallest piece or its block's own size, at the block's line height. Pure: the
// measurer is the port.
import type { FontSpec, TextMeasurer } from '../ports/ports.js';
import type { WrappedText } from './wrap.js';

/**
 * A piece of text with its own font, in terms of the block's.
 *
 * @public
 */
export type StyledRun = {
  /** The text; `\n` is a hard break. */
  readonly text: string;
  /** A size in px, whatever the block's (a size mark). */
  readonly size?: number;
  /** A size as a multiple of the block's (inline code). */
  readonly em?: number;
  /** Weight (a bold mark: 700). */
  readonly weight?: number;
  /** `italic` (an italic mark). */
  readonly style?: string;
  /** A font family (a font mark). */
  readonly family?: string;
};

/**
 * A paragraph, heading or list item laid out.
 *
 * @public
 */
export type StyledBlock = {
  /** Its text in runs. */
  readonly runs: readonly StyledRun[];
  /** Its size as a multiple of the base font's (a heading), 1 when omitted. */
  readonly scale?: number;
  /** Its weight (a heading: 700); a run's own wins. */
  readonly weight?: number;
  /** Its own line height, a multiple of its size, over the base font's. */
  readonly lineHeight?: number;
  /** Space above, px. */
  readonly before?: number;
  /** Space below, px. */
  readonly after?: number;
  /** Indent as a multiple of the base size (a list's: 1.5 per level). */
  readonly indentEm?: number;
};

/**
 * How styled blocks are laid out.
 *
 * @public
 */
export type StyledOptions = {
  /** The width the text may take, in px. */
  readonly maxWidth: number;
  /** `collapse`: the space between two blocks is the larger of the two (a block layout); `add` (default): both (a flex column; the blocks of a list still collapse). */
  readonly spacing?: 'collapse' | 'add';
};

/** One piece of a line: text in one font. */
type Piece = { readonly text: string; readonly font: FontSpec };

/** A token of a block: a word or a space in a font, or a hard break. */
type Token =
  | { readonly type: 'word'; readonly text: string; readonly font: FontSpec }
  | { readonly type: 'space'; readonly font: FontSpec }
  | { readonly type: 'break' };

const key = (f: FontSpec): string => `${f.family}\u0000${f.size}\u0000${f.weight}\u0000${f.style}`;

/** The font of a run in a block whose own font is `block`. */
function runFont(run: StyledRun, block: FontSpec): FontSpec {
  const size = run.size ?? (run.em === undefined ? block.size : run.em * block.size);
  return { ...block, size, weight: run.weight ?? block.weight ?? 400, style: run.style ?? block.style ?? 'normal', family: run.family ?? block.family };
}

/** The token of the `k`-th part of a run's text split at its separators (a break, or a run of white space): the odd ones. */
function tokenOf(part: string, k: number, font: FontSpec): Token[] {
  if (part === '') return [];
  if (k % 2 === 0) return [{ type: 'word', text: part, font }];
  return [part === '\n' ? { type: 'break' } : { type: 'space', font }];
}

/** The words and single spaces of a block's runs (a run of white space is one space; `\n` a break). */
function tokens(runs: readonly StyledRun[], block: FontSpec): Token[] {
  return runs.flatMap((run) => {
    const font = runFont(run, block);
    // tzap disable next-line Regex: white space split one character at a time gives several spaces, and the pending one is replaced by each
    return run.text.split(/(\n|[ \t\r\f\v]+)/).flatMap((part, k) => tokenOf(part, k, font));
  });
}

/** The width of `pieces`: those of one font together, so what the measurer shapes across words is kept. */
function width(pieces: readonly Piece[], measurer: TextMeasurer): number {
  let total = 0;
  let group: { font: FontSpec; text: string } | undefined;
  for (const p of pieces) {
    if (group !== undefined && key(group.font) === key(p.font)) group = { font: group.font, text: group.text + p.text };
    else {
      if (group !== undefined) total += measurer.measure(group.text, group.font).width;
      group = { font: p.font, text: p.text };
    }
  }
  return group === undefined ? total : total + measurer.measure(group.text, group.font).width;
}

/** A laid-out line: its text, its width and its height. */
type Line = { readonly text: string; readonly width: number; readonly height: number };

/** What a block is laid out in. */
type Layout = {
  /** The block's own font. */
  readonly block: FontSpec;
  /** Its line height, a multiple of a line's tallest piece. */
  readonly lineHeight: number;
  /** The width left for its text. */
  readonly maxWidth: number;
  readonly measurer: TextMeasurer;
};

/** Words added to lines one at a time, breaking before the one that does not fit. */
class LineBuilder {
  readonly lines: Line[] = [];
  #pieces: Piece[] = [];
  #pending: Piece | undefined;
  readonly #layout: Layout;

  constructor(layout: Layout) {
    this.#layout = layout;
  }

  /** End the line. */
  end(): void {
    const { block, lineHeight, measurer } = this.#layout;
    const tallest = Math.max(block.size, ...this.#pieces.map((p) => p.font.size));
    this.lines.push({ text: this.#pieces.map((p) => p.text).join(''), width: width(this.#pieces, measurer), height: tallest * lineHeight });
    this.#pieces = [];
    this.#pending = undefined;
  }

  /** A space in `font`, kept until a word follows on the same line (a leading or trailing one is dropped). */
  space(font: FontSpec): void {
    this.#pending = { text: ' ', font };
  }

  /** A word: on this line if it fits, else on the next (a word wider than the line stands alone). */
  word(word: Piece): void {
    const candidate = this.#pending === undefined ? [...this.#pieces, word] : [...this.#pieces, this.#pending, word];
    if (this.#pieces.length > 0 && width(candidate, this.#layout.measurer) > this.#layout.maxWidth) this.end();
    this.#pieces = this.#pieces.length === 0 ? [word] : candidate;
    this.#pending = undefined;
  }

  /** The lines; a block with no text draws none, and a break at its end adds none (as a browser lays them out). */
  finish(): Line[] {
    if (this.#pieces.length > 0) this.end();
    return this.lines;
  }
}

/** The lines of one block's runs in `layout`. */
function blockLines(runs: readonly StyledRun[], layout: Layout): Line[] {
  const builder = new LineBuilder(layout);
  for (const t of tokens(runs, layout.block)) {
    switch (t.type) {
      case 'break':
        builder.end();
        break;
      case 'space':
        builder.space(t.font);
        break;
      case 'word':
        builder.word({ text: t.text, font: t.font });
        break;
    }
  }
  return builder.finish();
}

/**
 * The space between a block and the one above: the larger of the two margins when they collapse (a block
 * layout), else both (a flex column). Two blocks of one list are in a block layout whatever holds the list.
 */
const gap = (above: number, below: number, collapses: boolean): number => (collapses ? Math.max(above, below) : above + below);

/**
 * `blocks` laid out in `options.maxWidth`: the lines as strings, the widest line and the height of everything
 * with the space around the blocks. `base` is the font of the label; only its size scales a heading and
 * an indent, a run's own size does not move with it.
 *
 * @public
 */
export function wrapStyled(blocks: readonly StyledBlock[], base: FontSpec, measurer: TextMeasurer, options: StyledOptions): WrappedText {
  const texts: string[] = [];
  let widest = 0;
  let height = 0;
  let space = 0;
  let previousAfter = 0;
  // tzap disable next-line BooleanLiteral: before the first block there is no space to collapse with
  let previousIndented = false;
  for (const b of blocks) {
    const font: FontSpec = { ...base, size: base.size * (b.scale ?? 1), weight: b.weight ?? base.weight ?? 400 };
    const indent = (b.indentEm ?? 0) * base.size;
    const lines = blockLines(b.runs, {
      block: font,
      lineHeight: b.lineHeight ?? base.lineHeight ?? 1.2,
      maxWidth: Math.max(0, options.maxWidth - indent),
      measurer,
    });
    for (const line of lines) {
      texts.push(line.text);
      widest = Math.max(widest, line.width + indent);
      height += line.height;
    }
    const [before, after] = [b.before ?? 0, b.after ?? 0];
    space += gap(previousAfter, before, options.spacing === 'collapse' || (previousIndented && indent > 0));
    previousAfter = after;
    previousIndented = indent > 0;
  }
  return { lines: texts, width: widest, height: height + space + previousAfter };
}
