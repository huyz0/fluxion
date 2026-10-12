// The streaming block splitter (FR-AI-010, 06-ai-authoring.md §6 stage 2): AI output arrives in chunks of any size; this cuts it into the
// header (everything up to and including the `screens:` line) and one block per `screens[]` item, each emitted the moment it is complete.
// It is a line machine on indentation only, never a YAML parse: a block that does not parse is the compiler's diagnostic, not the splitter's.
//
// Limits (all of them fall back to "emit later", never to "emit a half screen"):
//  - The `screens:` key must stand alone on its line at column 0, with at most a comment after it. `screens: [...]` (flow style), a quoted
//    `"screens":` key, or a `screens:` line inside a top-level multi-line flow collection is not recognised: the whole text is then the header.
//  - A screen is a sequence item (`-` followed by a space or the line end) at the indent of the first item; any item at that indent starts the
//    next screen, whether or not it begins `id:`. A deeper `- ` line (a nested sequence) continues the screen. A block scalar or a multi-line
//    quoted scalar cannot hold a line at the item's indent (YAML needs its lines deeper than the item), so tracking indent alone is sound.
//  - Blank and comment lines belong to the block they appear in: trailing ones to the screen before the next item, leading ones (between
//    `screens:` and the first item) to the first screen.
//  - A content line at the item indent that is no item, or at a lower indent (a top-level key after the screens, a `---` or `...` marker),
//    ends the screens: its text and everything after it is the `tail`, emitted by `end()`.
//  - A line is complete at its `\n`; a final line without one is complete at `end()`. A `\r` before the `\n` is kept in the text.
//  - Tabs count as one column of indent.
// The pieces concatenate back to the input: header, then every screen in order, then the tail.

/**
 * One screen block cut from a stream: the text of its `screens[]` item, and where it starts in the input.
 *
 * @public
 */
export type ScreenBlock = {
  /** The block's text, from its item line (or the comments before the first item) to the line before the next item. */
  readonly text: string;
  /** Offset of the block's first character in the whole input. */
  readonly offset: number;
  /** Line (1-based) of the block's first character in the whole input. */
  readonly line: number;
};

/**
 * What a {@link StreamSplitter} found complete since its last call. Every field is new: nothing is reported twice.
 *
 * @public
 */
export type SplitOutput = {
  /** The text up to and including the `screens:` line, once it is complete; with no `screens:` line, the whole input at `end()`. */
  readonly header?: string;
  /** The screen blocks that completed, in order. */
  readonly screens: readonly ScreenBlock[];
  /** The text after the last screen (top-level keys that follow `screens:`), at `end()`; absent when there is none. */
  readonly tail?: string;
};

/**
 * A stateful cutter of a text stream into its header and screen blocks. Feed it chunks of any size; it holds back a partial line.
 *
 * @public
 */
export type StreamSplitter = {
  /** Feed the next chunk; returns what it completed. Throws after {@link StreamSplitter.end}. */
  push(chunk: string): SplitOutput;
  /** End the input: the last partial line counts as complete, and the open block, the header (if never emitted) and the tail are emitted. */
  end(): SplitOutput;
};

/** The `screens:` key alone on its line (a comment may follow). */
export const SCREENS_KEY: RegExp = /^screens[ \t]*:[ \t]*(#.*)?\r?\n?$/;
const BLANK_OR_COMMENT = /^[ \t]*(#.*)?\r?\n?$/;
const ITEM = /^([ \t]*)-(?:[ \t]|\r?\n?$)/;
const INDENT = /^[ \t]*/;

type Phase = 'header' | 'screens' | 'tail';
type State = {
  phase: Phase;
  /** The partial line held back. */
  pending: string;
  header: string;
  headerDone: boolean;
  /** The open block's lines, and its start. */
  block: string;
  blockOffset: number;
  blockLine: number;
  /** The indent of the screen items, -1 until the first one. */
  indent: number;
  tail: string;
  /** Offset and 1-based line of the next complete line. */
  offset: number;
  line: number;
  ended: boolean;
};
type Out = { header?: string; screens: ScreenBlock[]; tail?: string };

function closeBlock(s: State, out: Out): void {
  if (s.indent >= 0) out.screens.push({ text: s.block, offset: s.blockOffset, line: s.blockLine });
  s.block = '';
}

function headerLine(s: State, line: string, out: Out): void {
  s.header += line;
  if (!SCREENS_KEY.test(line)) return;
  out.header = s.header;
  s.headerDone = true;
  s.phase = 'screens';
}

/** Add a line to the open block, which starts at the line when it was empty. */
function join(s: State, line: string): void {
  if (s.block === '') [s.blockOffset, s.blockLine] = [s.offset, s.line];
  s.block += line;
}

/** The screens ended at `line`: a top-level key, a document marker, or a line out of indent. Comments held before a first item are the tail's. */
function startTail(s: State, line: string, out: Out): void {
  if (s.indent < 0) s.tail = s.block;
  else closeBlock(s, out);
  s.block = '';
  s.tail += line;
  s.phase = 'tail';
}

/** Where a screens-phase line goes: a new item closes the open block, a deeper or blank line joins it, anything else starts the tail. */
function screensLine(s: State, line: string, out: Out): void {
  const indent = (INDENT.exec(line) as RegExpExecArray)[0].length;
  const first = s.indent < 0;
  const continues = BLANK_OR_COMMENT.test(line) || (!first && indent > s.indent);
  const startsItem = ITEM.test(line) && (first || indent === s.indent);
  if (!(continues || startsItem)) {
    startTail(s, line, out);
    return;
  }
  if (startsItem && first) s.indent = indent;
  else if (startsItem) closeBlock(s, out);
  join(s, line);
}

function lineOf(s: State, line: string, out: Out): void {
  if (s.phase === 'header') headerLine(s, line, out);
  else if (s.phase === 'screens') screensLine(s, line, out);
  else s.tail += line;
  s.offset += line.length;
  s.line += 1;
}

const frozen = (out: Out): SplitOutput => ({
  screens: out.screens,
  ...(out.header !== undefined ? { header: out.header } : {}),
  ...(out.tail !== undefined ? { tail: out.tail } : {}),
});

/**
 * Create a splitter for one stream. It is pure: no clock, no timers; the same chunks in any chunking give the same pieces.
 *
 * @returns a splitter (see the limits at the top of this file)
 * @public
 */
export function createStreamSplitter(): StreamSplitter {
  const s: State = {
    phase: 'header',
    pending: '',
    header: '',
    headerDone: false,
    block: '',
    blockOffset: 0,
    blockLine: 1,
    indent: -1,
    tail: '',
    offset: 0,
    line: 1,
    ended: false,
  };
  const alive = () => {
    if (s.ended) throw new Error('the stream splitter has ended');
  };
  return {
    push(chunk) {
      alive();
      const out: Out = { screens: [] };
      s.pending += chunk;
      for (let at = s.pending.indexOf('\n'); at >= 0; at = s.pending.indexOf('\n')) {
        lineOf(s, s.pending.slice(0, at + 1), out);
        s.pending = s.pending.slice(at + 1);
      }
      return frozen(out);
    },
    end() {
      alive();
      const out: Out = { screens: [] };
      if (s.pending !== '') lineOf(s, s.pending, out);
      s.pending = '';
      s.ended = true;
      if (s.phase === 'screens' && s.indent < 0) s.tail = s.block;
      else if (s.phase === 'screens') closeBlock(s, out);
      if (!s.headerDone) out.header = s.header;
      if (s.tail !== '') out.tail = s.tail;
      return frozen(out);
    },
  };
}
