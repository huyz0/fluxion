// The streaming compiler (FR-AI-010, 06-ai-authoring.md §6 stage 2): text arrives in chunks; the header is compiled once, and every screen
// block is compiled into the running document the moment the splitter completes it, so a consumer renders screens as they come. After
// `end()` the running document is the whole-file compile's, byte for byte once serialized, for a well-formed file.
//
// How the equality is kept: a block is compiled as a mini file, the header, then the earlier blocks blanked (every character but a line
// break becomes a space, so line, column and offset stay those of the whole input), then the block; its screens are upserted into the
// running document (stream/upsert.ts). The compile's other per-file steps are not repeated: the header's own diagnostics (a range inside the
// header) are reported once, with the header. Screen `index` values continue after the last screen, as `compile` numbers them. A diagnostic
// `path` is relative to the mini file (`/screens/0/…`), its `source` to the whole input. A screen id used twice in a stream is upserted twice
// (the later wins) where the whole-file compile reports FLX_DSL_DUPLICATE_ID. A diagnostic without a source range is reported once, where it
// first arises. Text after the screens (the tail) is compiled at `end()`. LIMIT: a tail key that changes how screens compile (`uses`,
// `theme`, `title`, `flux`) cannot be known when the screens stream by, so the screens are compiled provisionally; at `end()` the whole input
// is compiled again and that result replaces the running document (`StreamUpdate.recompiled`). Deferred-only tail keys (`vars`, `settings`)
// stay a plain tail. So after `end()` the document equals the whole-file compile for any well-formed file.
import type { DocumentFile } from '@fluxion/schema';
import { compileText } from '../compile.js';
import { KEYS } from '../read/fields.js';
import type { CompileOptions, DslDiagnostic } from '../types.js';
import { createStreamSplitter, SCREENS_KEY, type ScreenBlock, type SplitOutput } from './split.js';

/**
 * What compiling the header, or the tail, of a stream gave.
 *
 * @public
 */
export type StreamPart = {
  /** The running document after this part (absent while nothing has compiled). */
  readonly doc: DocumentFile | undefined;
  /** Its diagnostics, with source ranges in the whole input. */
  readonly diagnostics: readonly DslDiagnostic[];
};

/**
 * One screen block of a stream, compiled into the running document.
 *
 * @public
 */
export type StreamScreen = {
  /** The screen's source id; absent when the block did not parse far enough to name one. */
  readonly id: string | undefined;
  /** The block's text. */
  readonly text: string;
  /** Whether the block compiled into the document. A block that did not (a syntax error) leaves the document as it was. */
  readonly compiled: boolean;
  /** The running document after this block (absent while nothing has compiled). */
  readonly doc: DocumentFile | undefined;
  /** The block's own diagnostics, with source ranges in the whole input. */
  readonly diagnostics: readonly DslDiagnostic[];
};

/**
 * What a {@link StreamCompiler} completed since its last call. Every field is new: nothing is reported twice.
 *
 * @public
 */
export type StreamUpdate = {
  /** The header, compiled, once it is complete. */
  readonly header?: StreamPart;
  /** The screens that completed, in order. */
  readonly screens: readonly StreamScreen[];
  /** The text after the screens, compiled at `end()` (only when it holds anything but blank lines and comments). */
  readonly tail?: StreamPart;
  /**
   * Set at `end()` when the tail holds a key that changes how screens compile (`flux`, `title`, `theme`, `uses`): the whole input was then
   * compiled again, `tail.doc` and `doc` are that authoritative result, and `tail.diagnostics` are the whole file's. The diagnostics and
   * documents of the screens emitted before are provisional.
   */
  readonly recompiled?: true;
};

/**
 * Compiles a text stream screen by screen into a running document.
 *
 * @public
 */
export type StreamCompiler = {
  /** Feed the next chunk (any size); returns what it completed. */
  push(chunk: string): StreamUpdate;
  /** End the stream: the last screen, and the tail, are compiled. */
  end(): StreamUpdate;
  /** The running document: the base (if any) with every completed part compiled into it. */
  readonly doc: DocumentFile | undefined;
};

/** Whether the tail has a column-0 key that changes how screens compile (every compiled top-level key but `screens`). */
const changesScreens = (tail: string): boolean =>
  (tail.match(/^[A-Za-z_][\w-]*(?=[ \t]*:)/gm) ?? []).some((k) => (KEYS.top.compiled as readonly string[]).includes(k) && k !== 'screens');
const isBlank = (text: string): boolean => text.split('\n').every((l) => /^[ \t\r]*(#.*)?$/.test(l));
/** The text with every character but a line break a space: same offsets, lines and columns, no content. */
const blanked = (text: string): string => text.replace(/[^\r\n]/g, ' ');
/** The id a block names when it did not compile: its first `id:` line. */
const idOfText = (text: string): string | undefined => /^[ \t]*-[ \t]+id[ \t]*:[ \t]*["']?([^\s"'#,}\]]+)/m.exec(text)?.[1];

/** `text` without its first `n` spaces (blanked text holds nothing else but line breaks): the tail's offsets stay those of the input. */
function dropSpaces(text: string, n: number): string {
  let left = n;
  return text.replace(/ /g, (space) => (left-- > 0 ? '' : space));
}

const EMPTY = ' []';
/** The header with its `screens:` key made an empty list (EMPTY longer), to compile on its own; a header without that key is the whole input. */
function headerAlone(header: string): string {
  const at = header.lastIndexOf('\n', header.length - 2) + 1;
  return SCREENS_KEY.test(header.slice(at)) ? header.slice(0, at) + header.slice(at).replace(/^(screens[ \t]*:)/, `$1${EMPTY}`) : header;
}

/**
 * Create a streaming compiler: chunks in, screens out as their blocks complete, each compiled into the running document.
 *
 * @param options - as for `compile`; `base`, when given, is the document the stream's screens are upserted into
 * @returns the compiler (one per stream)
 * @public
 */
export function createStreamCompiler(options: CompileOptions): StreamCompiler {
  const splitter = createStreamSplitter();
  let running: DocumentFile | undefined = options.base;
  let header = '';
  let before = '';
  /** The input so far, as written (the header and the blocks). */
  let whole = '';
  const compileInto = (text: string) => {
    const { result, screens } = compileText(text, running ? { ...options, base: running } : options);
    if (result.doc) running = result.doc;
    return { result, screens };
  };
  const reported = new Set<string>();
  /** A diagnostic with no source is reported once, in the first part it arises in. */
  const fresh = (d: DslDiagnostic): boolean => {
    if (d.source) return true;
    const key = `${d.code}|${d.path}|${d.message}`;
    return !reported.has(key) && !!reported.add(key);
  };
  /** A part compiled on its own: only the diagnostics at or after `from` are its own (the header's were reported with the header). */
  const part = (text: string, from = 0): StreamPart => ({
    diagnostics: compileInto(text)
      .result.diagnostics.filter((d) => (d.source ? d.source.offset >= from : true))
      .filter(fresh),
    doc: running,
  });
  const screenOf = (block: ScreenBlock): StreamScreen => {
    const { result, screens } = compileInto(header + before + block.text);
    before += blanked(block.text);
    whole += block.text;
    const own = result.diagnostics.filter((d) => (d.source ? d.source.offset >= header.length : true)).filter(fresh);
    return { id: screens[0] ?? idOfText(block.text), text: block.text, compiled: result.doc !== undefined, doc: running, diagnostics: own };
  };
  const tailOf = (text: string): { tail: StreamPart; recompiled?: true } => {
    if (!changesScreens(text)) return { tail: part(headerAlone(header) + dropSpaces(before, EMPTY.length) + text, header.length + before.length) };
    const result = compileText(whole + text, options).result;
    if (result.doc) running = result.doc;
    return { tail: { diagnostics: result.diagnostics, doc: running }, recompiled: true };
  };
  const handle = (out: SplitOutput): StreamUpdate => {
    if (out.header !== undefined) {
      header = out.header;
      whole = out.header;
    }
    const headerPart = out.header !== undefined ? part(headerAlone(out.header)) : undefined;
    const screens = out.screens.map(screenOf);
    const tail = out.tail !== undefined && !isBlank(out.tail) ? tailOf(out.tail) : undefined;
    return { screens, ...(headerPart ? { header: headerPart } : {}), ...(tail ?? {}) };
  };
  return {
    push: (chunk) => handle(splitter.push(chunk)),
    end: () => handle(splitter.end()),
    get doc() {
      return running;
    },
  };
}
