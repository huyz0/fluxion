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
  /** Where its lines sit (`layoutStyled`; a block's own CSS `text-align`), over the options' `align`. */
  readonly align?: string;
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
  /** Where a line sits in `maxWidth` (`layoutStyled`; CSS `text-align`): `left` (default), `center` or `right`; `justify` lays out as `left`. */
  readonly align?: string;
};

/**
 * A piece of a laid-out line: text in one font, at `x` from the left of the text box.
 *
 * @public
 */
export type LaidOutPiece = {
  /** The text. */
  readonly text: string;
  /** Its font. */
  readonly font: FontSpec;
  /** Its left edge, px from the text box's left. */
  readonly x: number;
  /** Its measured width, px. */
  readonly width: number;
  /** The index of the run of its block it comes from (pieces split where runs meet, so a run's marks can be drawn). */
  readonly run: number;
};

/**
 * A laid-out line.
 *
 * @public
 */
export type LaidOutLine = {
  /** Its text (the pieces' together). */
  readonly text: string;
  /** Its top, px from the text's top. */
  readonly top: number;
  /** Its height (its tallest piece or its block's size, times the block's line height). */
  readonly height: number;
  /** Its baseline, px from the text's top: the half-leading and the tallest piece's ascent below its top. */
  readonly baseline: number;
  /** Its left edge, px from the text box's left: the block's indent and the alignment offset. */
  readonly x: number;
  /** Its width. */
  readonly width: number;
  /** Its pieces, left to right: text of one font from one run, each at its place in the line as measured whole. */
  readonly pieces: readonly LaidOutPiece[];
  /** The index of the block it belongs to. */
  readonly block: number;
};

/**
 * Styled blocks laid out as they are drawn: each line with its place, baseline and pieces (ADR-0056 item 3).
 *
 * @public
 */
export type LaidOutText = {
  /** The lines, in order. */
  readonly lines: readonly LaidOutLine[];
  /** The widest line, its indent included. */
  readonly width: number;
  /** The height of everything with the space around the blocks. */
  readonly height: number;
};

/** One piece of a line: text in one font, from run `run` of its block. */
type Piece = { readonly text: string; readonly font: FontSpec; readonly run: number };

/** A token of a block: a word or a space in a font from run `run`, or a hard break. */
type Token =
  | { readonly type: 'word'; readonly text: string; readonly font: FontSpec; readonly run: number }
  | { readonly type: 'space'; readonly font: FontSpec; readonly run: number }
  | { readonly type: 'break' };

const key = (f: FontSpec): string => `${f.family}\u0000${f.size}\u0000${f.weight}\u0000${f.style}`;

/** The font of a run in a block whose own font is `block`. */
function runFont(run: StyledRun, block: FontSpec): FontSpec {
  const size = run.size ?? (run.em === undefined ? block.size : run.em * block.size);
  return { ...block, size, weight: run.weight ?? block.weight ?? 400, style: run.style ?? block.style ?? 'normal', family: run.family ?? block.family };
}

/** The token of the `k`-th part of a run's text split at its separators (a break, or a run of white space): the odd ones. */
function tokenOf(part: string, k: number, font: FontSpec, run: number): Token[] {
  if (part === '') return [];
  if (k % 2 === 0) return [{ type: 'word', text: part, font, run }];
  return [part === '\n' ? { type: 'break' } : { type: 'space', font, run }];
}

/** The words and single spaces of a block's runs (a run of white space is one space; `\n` a break). */
function tokens(runs: readonly StyledRun[], block: FontSpec): Token[] {
  return runs.flatMap((run, r) => {
    const font = runFont(run, block);
    // tzap disable next-line Regex: white space split one character at a time gives several spaces, and the pending one is replaced by each
    return run.text.split(/(\n|[ \t\r\f\v]+)/).flatMap((part, k) => tokenOf(part, k, font, r));
  });
}

/** The text of a group from one run. */
type Segment = { readonly text: string; readonly run: number };

/** A group of a line: neighbours of one font joined and measured whole, with the runs it holds in order. */
type Group = { readonly text: string; readonly font: FontSpec; readonly width: number; readonly segments: readonly Segment[] };

/** `segments` with `p` added: to the last one when it is from the same run. */
function addSegment(segments: readonly Segment[], p: Piece): Segment[] {
  const last = segments.at(-1);
  return last?.run === p.run ? [...segments.slice(0, -1), { text: last.text + p.text, run: p.run }] : [...segments, { text: p.text, run: p.run }];
}

/** `pieces` with neighbours of one font joined, each measured: what the measurer shapes across words is kept. */
function groups(pieces: readonly Piece[], measurer: TextMeasurer): Group[] {
  const joined: { text: string; font: FontSpec; segments: Segment[] }[] = [];
  for (const p of pieces) {
    const last = joined.at(-1);
    if (last !== undefined && key(last.font) === key(p.font))
      joined[joined.length - 1] = { font: last.font, text: last.text + p.text, segments: addSegment(last.segments, p) };
    else joined.push({ text: p.text, font: p.font, segments: [{ text: p.text, run: p.run }] });
  }
  return joined.map((g) => ({ ...g, width: measurer.measure(g.text, g.font).width }));
}

/** The width of `pieces`, measured as {@link groups}. */
const width = (pieces: readonly Piece[], measurer: TextMeasurer): number => groups(pieces, measurer).reduce((total, g) => total + g.width, 0);

/** A laid-out line of a block: its text, width and height, its measured pieces, and the font its baseline follows. */
type Line = {
  readonly text: string;
  readonly width: number;
  readonly height: number;
  readonly pieces: readonly Group[];
  readonly tallest: FontSpec;
};

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
    const tallest = this.#pieces.reduce((t, p) => (p.font.size > t.size ? p.font : t), block);
    const pieces = groups(this.#pieces, measurer);
    const text = this.#pieces.map((p) => p.text).join('');
    this.lines.push({ text, width: pieces.reduce((w, g) => w + g.width, 0), height: tallest.size * lineHeight, pieces, tallest });
    this.#pieces = [];
    this.#pending = undefined;
  }

  /** A space in `font`, kept until a word follows on the same line (a leading or trailing one is dropped). */
  space(font: FontSpec, run: number): void {
    this.#pending = { text: ' ', font, run };
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
        builder.space(t.font, t.run);
        break;
      case 'word':
        builder.word({ text: t.text, font: t.font, run: t.run });
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

/** How far a line of `width` sits from the left of `room` under `align`. */
function alignOffset(align: string | undefined, room: number, width: number): number {
  if (align === 'center') return (room - width) / 2;
  if (align === 'right' || align === 'end') return room - width;
  return 0;
}

/** The baseline of a line of `height` at `top` whose tallest font is `font` (CSS: half the leading above the content area). */
function baselineOf(line: Line, top: number, measurer: TextMeasurer): number {
  const m = measurer.measure(line.text === '' ? ' ' : line.text, line.tallest);
  return top + (line.height - (m.ascent + m.descent)) / 2 + m.ascent;
}

/**
 * Group `g` at `left` as pieces of one run each: a run's place is the width of the group's text before it, measured with the font, so
 * the pieces sit where the whole group is drawn (no measurer: one piece, as a wrap reads none).
 */
function runPieces(g: Group, left: number, measurer: TextMeasurer | undefined): LaidOutPiece[] {
  const [first] = g.segments;
  if (measurer === undefined || first === undefined || g.segments.length === 1)
    return [{ text: g.text, font: g.font, x: left, width: g.width, run: first?.run ?? 0 }];
  let before = '';
  let start = 0;
  return g.segments.map((s, k) => {
    before += s.text;
    const end = k === g.segments.length - 1 ? g.width : measurer.measure(before, g.font).width;
    const piece = { text: s.text, font: g.font, x: left + start, width: end - start, run: s.run };
    start = end;
    return piece;
  });
}

/** Where a block's lines are placed: from `top`, after `indent`, in `room`, aligned by `align`, as block `block`. */
type Placement = { readonly top: number; readonly indent: number; readonly room: number; readonly align: string | undefined; readonly block: number };

/** A block's laid-out lines placed at `at`. */
function placeLines(lines: readonly Line[], at: Placement, measurer: TextMeasurer | undefined): LaidOutLine[] {
  let top = at.top;
  return lines.map((line) => {
    const x = at.indent + alignOffset(at.align, at.room, line.width);
    let left = x;
    const pieces = line.pieces.flatMap((p) => {
      const split = runPieces(p, left, measurer);
      left += p.width;
      return split;
    });
    const placed = {
      text: line.text,
      top,
      height: line.height,
      baseline: measurer === undefined ? 0 : baselineOf(line, top, measurer),
      x,
      width: line.width,
      pieces,
      block: at.block,
    };
    top += line.height;
    return placed;
  });
}

/** How a pass lays out: its measurer and options, and whether it measures baselines (a wrap reads none, and measures nothing more). */
type Pass = { readonly measurer: TextMeasurer; readonly options: StyledOptions; readonly baselines: boolean };

/** Block `b` (the `index`-th)'s lines at `top`: its own font, indent and room under `base`. */
function blockOf(
  b: StyledBlock,
  base: FontSpec,
  at: { readonly top: number; readonly index: number },
  pass: Pass,
): { readonly lines: LaidOutLine[]; readonly indent: number } {
  const { measurer, options } = pass;
  const top = at.top;
  const font: FontSpec = { ...base, size: base.size * (b.scale ?? 1), weight: b.weight ?? base.weight ?? 400 };
  const indent = (b.indentEm ?? 0) * base.size;
  const room = Math.max(0, options.maxWidth - indent);
  const lines = blockLines(b.runs, { block: font, lineHeight: b.lineHeight ?? base.lineHeight ?? 1.2, maxWidth: room, measurer });
  const placement = { top, indent, room, align: b.align ?? options.align, block: at.index };
  return { lines: placeLines(lines, placement, pass.baselines ? measurer : undefined), indent };
}

/** {@link layoutStyled} in `pass`. */
function lay(blocks: readonly StyledBlock[], base: FontSpec, pass: Pass): LaidOutText {
  const out: LaidOutLine[] = [];
  let widest = 0;
  let y = 0;
  let previousAfter = 0;
  // tzap disable next-line BooleanLiteral: before the first block there is no space to collapse with
  let previousIndented = false;
  for (const [index, b] of blocks.entries()) {
    const indented = (b.indentEm ?? 0) > 0;
    y += gap(previousAfter, b.before ?? 0, pass.options.spacing === 'collapse' || (previousIndented && indented));
    const { lines, indent } = blockOf(b, base, { top: y, index }, pass);
    for (const line of lines) {
      out.push(line);
      widest = Math.max(widest, line.width + indent);
      y += line.height;
    }
    previousAfter = b.after ?? 0;
    previousIndented = indented;
  }
  return { lines: out, width: widest, height: y + previousAfter };
}

/**
 * `blocks` laid out in `options.maxWidth` as they are drawn (ADR-0056 item 3): each line with its top, height, baseline, its
 * alignment offset and its pieces of one font with their `x`; the widest line and the height of everything with the space around
 * the blocks. `base` is the font of the label; only its size scales a heading and an indent, a run's own size does not move with
 * it. `wrapStyled` is its projection.
 *
 * @public
 */
export function layoutStyled(blocks: readonly StyledBlock[], base: FontSpec, measurer: TextMeasurer, options: StyledOptions): LaidOutText {
  return lay(blocks, base, { measurer, options, baselines: true });
}

/**
 * `blocks` laid out in `options.maxWidth`: the lines as strings, the widest line and the height of everything
 * with the space around the blocks. `base` is the font of the label; only its size scales a heading and
 * an indent, a run's own size does not move with it. The projection of {@link layoutStyled}.
 *
 * @public
 */
export function wrapStyled(blocks: readonly StyledBlock[], base: FontSpec, measurer: TextMeasurer, options: StyledOptions): WrappedText {
  const laid = lay(blocks, base, { measurer, options, baselines: false });
  return { lines: laid.lines.map((l) => l.text), width: laid.width, height: laid.height };
}
