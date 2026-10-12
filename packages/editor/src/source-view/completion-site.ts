// Where the cursor is in a FluxScript document and what is being written there (FR-DSL-009, ADR-0032): the first half of completion. Pure text
// analysis that expects a document mid-edit: it reads the cursor's line and the lines above for the keys that enclose it (by indentation), never
// the whole tree, so an invalid document still completes. Part of the lazy source-view chunk.
import { yamlLanguage } from '@codemirror/lang-yaml';
import { CHILD, type Level } from './fluxscript-tokens.js';

/** What the cursor is completing. `from` is where the partial word starts. */
export type Site =
  | { readonly kind: 'shape' | 'token' | 'pack' | 'slug' | 'anchor' | 'op'; readonly from: number }
  /** A slug, or an edge object key, at the start of an edge line. */
  | { readonly kind: 'edge-start'; readonly from: number }
  | { readonly kind: 'key'; readonly level: Level; readonly from: number };

/** The shape of the value a key of `CHILD` opens, as a state of the walk down the enclosing keys. */
type State = { readonly t: 'map' | 'seq' | 'slugs'; readonly level: Level } | { readonly t: 'none' };
const NONE: State = { t: 'none' };

/** The characters of a word that is a slug, an anchor, a token or a shape id. */
const isWord = (c: string): boolean => /[\w.:-]/.test(c);
/** The characters of a key. */
const isKey = (c: string): boolean => /[\w-]/.test(c);
/** Any character that is not whitespace. */
const isSolid = (c: string): boolean => !/\s/.test(c);

/**
 * The run of `isWordChar` characters that ends at `pos`, found by walking back from the cursor (a `/x*$/` regex is tried from every start and takes
 * quadratic time on a long line of word characters, M12.54 review).
 */
export function wordBefore(text: string, pos: number, isWordChar: (c: string) => boolean): string {
  let start = pos;
  while (start > 0 && isWordChar(text.charAt(start - 1))) start--;
  return text.slice(start, pos);
}

type Line = { readonly ind: number; readonly dashes: number; readonly kc: number; readonly key?: string; readonly valueEmpty: boolean };
type Bracket = { readonly ch: string; readonly at: number };
type Scan = { readonly inQuote: boolean; readonly comment: boolean; readonly colon: number; readonly stack: readonly Bracket[] };

/** The scan of a line's text after its dashes, one character at a time. */
class Scanner {
  quote = '';
  comment = false;
  colon = -1;
  readonly stack: Bracket[] = [];
  readonly rest: string;
  constructor(rest: string) {
    this.rest = rest;
  }

  run(): Scan {
    for (let i = 0; i < this.rest.length && !this.comment; i++) {
      const c = this.rest[i] as string;
      const prev = i === 0 ? ' ' : (this.rest[i - 1] as string);
      if (this.quote === '') this.plain(i, c, prev);
      else if (c === this.quote && prev !== '\\') this.quote = '';
    }
    return { inQuote: this.quote !== '', comment: this.comment, colon: this.colon, stack: this.stack };
  }

  plain(i: number, c: string, prev: string): void {
    if ((c === '"' || c === "'") && /[\s[{,:]/.test(prev)) this.quote = c;
    else if (c === '#' && /\s/.test(prev)) this.comment = true;
    else if (c === '[' || c === '{') this.stack.push({ ch: c, at: i });
    else if (c === ']' || c === '}') this.stack.pop();
    else if (c === ':' && this.stack.length === 0 && this.colon < 0 && this.rest[i + 1] === ' ') this.colon = i;
  }
}

/** Scans a line's text after its dashes: quotes, a comment, the first colon outside brackets (a key's), and the brackets still open. */
const scan = (rest: string): Scan => new Scanner(rest).run();

const unquote = (s: string): string => s.trim().replace(/^(["'])(.*)\1$/, '$2');

/** The key of a line's text after its dashes (`key: value` or `key:`) and whether its value is empty. */
function keyOf(rest: string): { readonly key: string; readonly valueEmpty: boolean } | undefined {
  const colon = scan(rest).colon;
  if (colon >= 0)
    return {
      key: unquote(rest.slice(0, colon)),
      valueEmpty:
        rest
          .slice(colon + 1)
          .replace(/\s#.*$/, '')
          .trim() === '',
    };
  const trimmed = rest.trimEnd();
  return trimmed.endsWith(':') ? { key: unquote(trimmed.slice(0, -1)), valueEmpty: true } : undefined;
}

/** A line's indentation, dashes and key column, and its key; nothing for a blank or comment line. */
function parseLine(text: string): Line | undefined {
  const m = /^( *)((?:-(?: +|$))*)/.exec(text) as RegExpExecArray;
  const rest = text.slice(m[0].length);
  if ((rest.trim() === '' && m[2] === '') || rest.trimStart().startsWith('#')) return undefined;
  return { ind: m[1]?.length ?? 0, dashes: (m[2] ?? '').split('-').length - 1, kc: m[0].length, ...(keyOf(rest) ?? { valueEmpty: false }) };
}

/** The keys (and `-` for a sequence item) that enclose a line at `limit`, outermost first; `loose` lets a key on the dash's own column enclose it. */
function enclosing(above: readonly string[], limit: number, loose: boolean): string[] {
  const path: string[] = [];
  let lim = limit;
  let strict = !loose;
  for (let i = above.length - 1; i >= 0 && !(lim <= 0 && strict); i--) {
    const l = parseLine(above[i] as string);
    if (l === undefined) continue;
    if (encloses(l, lim, strict)) {
      path.unshift(l.key as string);
      lim = l.kc;
      strict = true;
    }
    if (l.dashes > 0 && l.ind < lim) {
      path.unshift('-');
      lim = l.ind;
      strict = true;
    }
  }
  return path;
}

/** Whether line `l` is a key with nothing after it that sits left of `lim` (or on it, unless `strict`). */
const encloses = (l: Line, lim: number, strict: boolean): boolean => l.key !== undefined && l.valueEmpty && (strict ? l.kc < lim : l.kc <= lim);

/** The state after going into `el` (a key, or `-` for an item) from `s`. */
function step(s: State, el: string): State {
  if (el === '-') return s.t === 'seq' ? { t: 'map', level: s.level } : NONE;
  if (s.t === 'slugs') return { t: 'map', level: s.level };
  // the shorthand `a -> b:` is a key of an edge item whose value holds the edge's other keys
  if (s.t === 'map' && s.level === 'edge' && /\s/.test(el)) return s;
  if (s.t !== 'map') return NONE;
  const shape = CHILD[s.level]?.[el];
  if (shape === undefined) return NONE;
  return { t: shape.of === 'map' ? 'map' : shape.of === 'items' ? 'seq' : 'slugs', level: shape.level };
}

const walk = (path: readonly string[]): State => path.reduce<State>(step, { t: 'map', level: 'top' });

/** The levels whose mapping has a `style` key. */
const STYLED: ReadonlySet<Level> = new Set<Level>(['node', 'group', 'edge']);

/** A walk down `els` from `from`: the state it ends in, and whether it passed through a `style` key (not a slug named `style`). */
function walkFrom(from: State, els: readonly string[]): { readonly state: State; readonly inStyle: boolean } {
  let state = from;
  let inStyle = false;
  for (const el of els) {
    if (el === 'style' && state.t === 'map' && STYLED.has(state.level)) inStyle = true;
    state = step(state, el);
  }
  return { state, inStyle };
}

/** Whether the cursor is inside a block scalar (`notes: |`): text there is prose. */
function inBlockScalar(text: string, pos: number): boolean {
  const tree = yamlLanguage.parser.parse(text);
  for (let n: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(pos, -1); n; n = n.parent) if (n.name === 'BlockLiteralContent') return true;
  return false;
}

type Ctx = { readonly level?: Level; readonly inStyle: boolean };

/** The kind of value a key holds, for the keys whose values are ids, packs, tokens or slugs. */
function valueKind(key: string, ctx: Ctx): 'shape' | 'token' | 'pack' | 'slug' | undefined {
  if ((key === 'shape' || key === 'component') && ctx.level === 'node') return 'shape';
  if (ctx.inStyle || key === 'background') return 'token';
  if (key === 'uses') return 'pack';
  if ((key === 'from' || key === 'to') && ctx.level === 'edge') return 'slug';
  return undefined;
}

/** A slug or its anchor (`api.` completes anchors): the word before the cursor decides. */
function slugOrAnchor(word: string, pos: number, kind: 'slug' | 'edge-start' = 'slug'): Site {
  const dot = word.indexOf('.');
  return dot < 0 ? { kind, from: pos - word.length } : { kind: 'anchor', from: pos - (word.length - dot - 1) };
}

/** The scalar `kind` of value being typed: a slug (edge ends) may carry an anchor. */
function valueSite(kind: 'shape' | 'token' | 'pack' | 'slug', word: string, pos: number): Site {
  return kind === 'slug' ? slugOrAnchor(word, pos) : { kind, from: pos - word.length };
}

/** The shorthand edge `a -> b`, cursor at the end of `rest`: slug (or edge key) first, op second, slug last. */
function edgeSite(rest: string, pos: number): Site | undefined {
  const word = wordBefore(rest, rest.length, isSolid);
  const head = rest.slice(0, rest.length - word.length).trim();
  const done = head === '' ? 0 : head.split(/\s+/).length;
  if (done === 0) return slugOrAnchor(word, pos, 'edge-start');
  if (done === 1) return { kind: 'op', from: pos - word.length };
  return done === 2 ? slugOrAnchor(word, pos) : undefined;
}

/** The mapping a line's keys belong to (a sequence item's, for a dashed line). */
const lineState = (s: State, dashed: boolean): State => (dashed ? step(s, '-') : s);

/** The cursor's line, read once: what the sites below decide from. */
type Cur = {
  readonly pos: number;
  readonly before: string;
  /** The line's text after its dashes, up to the cursor. */
  readonly rest: string;
  readonly sc: Scan;
  readonly dashed: boolean;
  /** The keys and `-` that enclose the line. */
  readonly path: readonly string[];
  /** The mapping the line's keys belong to. */
  readonly state: State;
  /** The key whose value opens the innermost flow collection still open on this line (`style: {`). */
  readonly owner: string | undefined;
  readonly inStyle: boolean;
};

const levelOf = (s: State): { level?: Level } => (s.t === 'none' ? {} : { level: s.level });

/** `[ a, | ]`: items of `contains` (slugs) or `uses` (packs). */
function seqFlow(c: Cur, part: string): Site | undefined {
  const word = wordBefore(part, part.length, isWord);
  if (c.sc.stack.length > 1) return undefined;
  const kind = c.owner === 'contains' ? 'slug' : c.owner === 'uses' ? 'pack' : undefined;
  return kind === undefined ? undefined : { kind, from: c.pos - word.length };
}

/** `{ a: b, c: | }`: a value of a key, or a key of the mapping the braces open. */
function mapFlow(c: Cur, part: string): Site | undefined {
  const owned = c.state;
  const value = /^\s*([\w-]+)\s*:\s+([\w.:-]*)$/.exec(part);
  if (value !== null) {
    const kind = valueKind(value[1] as string, { ...levelOf(owned), inStyle: c.inStyle });
    return kind === undefined ? undefined : valueSite(kind, value[2] as string, c.pos);
  }
  const key = /^\s*([\w-]*)$/.exec(part);
  return key !== null && owned.t === 'map' ? { kind: 'key', level: owned.level, from: c.pos - (key[1] as string).length } : undefined;
}

/** A flow collection still open on the line. */
function flowSite(c: Cur): Site | undefined {
  const inner = c.sc.stack[c.sc.stack.length - 1] as Bracket;
  const seg = c.rest.slice(inner.at + 1);
  const part = seg.slice(seg.lastIndexOf(',') + 1);
  return inner.ch === '[' ? seqFlow(c, part) : mapFlow(c, part);
}

/** A bare word on a dashed line: an item of `contains` or `uses`, an edge, or the first key of a mapping item. */
function itemSite(rest: string, pos: number, state: State, last: string | undefined): Site | undefined {
  const word = wordBefore(rest, rest.length, isWord);
  if (last === 'contains' || last === 'uses') return { kind: last === 'uses' ? 'pack' : 'slug', from: pos - word.length };
  if (state.t !== 'seq') return undefined;
  return state.level === 'edge' ? edgeSite(rest, pos) : { kind: 'key', level: state.level, from: pos - wordBefore(rest, rest.length, isKey).length };
}

/** The key whose value opens the `k`th open bracket (`key: {`), if the bracket has one. */
function bracketOwner(rest: string, stack: readonly Bracket[], k: number): string | undefined {
  const start = k === 0 ? 0 : (stack[k - 1] as Bracket).at + 1;
  const seg = rest.slice(start, (stack[k] as Bracket).at);
  // trim, not a regex: `^\s*(.+?)\s*:\s*$` backtracks cubically on a long run of whitespace (M12.54 review)
  const tail = seg.slice(seg.lastIndexOf(',') + 1).trim();
  if (!tail.endsWith(':')) return undefined;
  const key = tail.slice(0, -1).trim();
  return key === '' ? undefined : unquote(key);
}

/** A bracket without a key: the braces of a flow sequence's item, the braces that open the line's own mapping, or something not read. */
const anonymous = (stack: readonly Bracket[], k: number): string[] =>
  (stack[k] as Bracket).ch === '{' ? (k === 0 ? [] : (stack[k - 1] as Bracket).ch === '[' ? ['-'] : ['?']) : ['?'];

/** The keys (and `-` for an item) the open brackets of a line go down through, outermost first. */
const flowElements = (rest: string, stack: readonly Bracket[]): string[] =>
  stack.flatMap((_, k) => {
    const owner = bracketOwner(rest, stack, k);
    return owner === undefined ? anonymous(stack, k) : [owner];
  });

/** The cursor's line and what encloses it, or nothing in a comment, a quoted string or a block scalar. */
function cursorAt(text: string, pos: number): Cur | undefined {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  const before = text.slice(lineStart, pos);
  const head = /^( *)((?:-(?: +|$))*)/.exec(before) as RegExpExecArray;
  const rest = before.slice(head[0].length);
  const sc = scan(rest);
  if (sc.comment || sc.inQuote || inBlockScalar(text, pos)) return undefined;
  const dashed = (head[2] ?? '').length > 0;
  const path = enclosing(text.slice(0, lineStart).split('\n').slice(0, -1), head[1]?.length ?? 0, dashed);
  const block = walkFrom({ t: 'map', level: 'top' }, path);
  const flow = walkFrom(lineState(block.state, dashed), flowElements(rest, sc.stack));
  return {
    pos,
    before,
    rest,
    sc,
    dashed,
    path,
    state: flow.state,
    owner: sc.stack.length > 0 ? bracketOwner(rest, sc.stack, sc.stack.length - 1) : undefined,
    inStyle: block.inStyle || flow.inStyle,
  };
}

/** The cursor is after `key: `. */
function valueAt(c: Cur): Site | undefined {
  const key = unquote(c.rest.slice(0, c.sc.colon));
  if (/\s/.test(key)) return undefined;
  const kind = valueKind(key, { ...levelOf(c.state), inStyle: c.inStyle });
  return kind === undefined ? undefined : valueSite(kind, wordBefore(c.before, c.before.length, isWord), c.pos);
}

/**
 * What is being completed at `pos` in `text`, or nothing when the cursor is in a comment, a quoted string, a block scalar or a place where
 * no completion is defined. The document may be invalid: only the lines above the cursor's, by indentation, are read.
 *
 * @param text - the FluxScript text
 * @param pos - the cursor offset
 * @returns the site, or undefined
 */
export function siteAt(text: string, pos: number): Site | undefined {
  const c = cursorAt(text, pos);
  if (c === undefined) return undefined;
  if (c.sc.stack.length > 0) return flowSite(c);
  if (c.sc.colon >= 0) return valueAt(c);
  if (c.rest.endsWith(':')) return undefined;
  if (c.dashed) return itemSite(c.rest, pos, walk(c.path), c.path[c.path.length - 1]);
  return c.state.t === 'map' ? { kind: 'key', level: c.state.level, from: pos - wordBefore(c.rest, c.rest.length, isKey).length } : undefined;
}
