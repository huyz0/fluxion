// Parse stage (ADR-0030, FR-DSL-001): FluxScript text to a tree of maps, sequences and scalars in which every node and every key keeps its
// source range, so each later stage reports line and column. The YAML is 1.2 core schema through `yaml`; anchors, aliases, tags and
// duplicate keys are refused (FLX_DSL_SYNTAX) because they hide structure from the source map and from models.
import { isAlias, isMap, isScalar, isSeq, LineCounter, type Node, parseDocument, type YAMLMap } from 'yaml';
import type { DslDiagnostic, SourceRange } from '../types.js';

/**
 * A parsed FluxScript value with its source range.
 *
 * @public
 */
export type YNode = YMap | YSeq | YScalar;

/**
 * A mapping: its entries in source order.
 *
 * @public
 */
export type YMap = {
  /** Discriminator. */
  readonly kind: 'map';
  /** Where it is. */
  readonly range: SourceRange;
  /** Its entries, in source order. */
  readonly entries: readonly YEntry[];
};

/**
 * One entry of a mapping.
 *
 * @public
 */
export type YEntry = {
  /** The key as text. */
  readonly key: string;
  /** Where the key is. */
  readonly keyRange: SourceRange;
  /** The value. */
  readonly value: YNode;
};

/**
 * A sequence.
 *
 * @public
 */
export type YSeq = {
  /** Discriminator. */
  readonly kind: 'seq';
  /** Where it is. */
  readonly range: SourceRange;
  /** Its items. */
  readonly items: readonly YNode[];
};

/**
 * A scalar: a string, number, boolean or null (an empty value is null).
 *
 * @public
 */
export type YScalar = {
  /** Discriminator. */
  readonly kind: 'scalar';
  /** Where it is. */
  readonly range: SourceRange;
  /** Its value. */
  readonly value: string | number | boolean | null;
};

/**
 * What the parse stage gives back: the tree (absent when the text does not parse) and the problems.
 *
 * @public
 */
export type ParseResult = {
  /** The root, a mapping for a FluxScript file; absent on a fatal syntax error. */
  readonly root?: YNode;
  /** Syntax problems (`FLX_DSL_SYNTAX`). */
  readonly diagnostics: readonly DslDiagnostic[];
};

/** A range from offsets, through the line counter. */
function rangeFrom(lines: LineCounter, offset: number, end: number): SourceRange {
  const a = lines.linePos(offset);
  const b = lines.linePos(end);
  return { line: a.line, col: a.col, endLine: b.line, endCol: b.col, offset, end };
}

type Ctx = { readonly lines: LineCounter; readonly diagnostics: DslDiagnostic[]; readonly text: string };

function syntax(ctx: Ctx, range: SourceRange, message: string, hint?: string): void {
  ctx.diagnostics.push({ code: 'FLX_DSL_SYNTAX', severity: 'error', path: '', message, source: range, ...(hint ? { hint } : {}) });
}

/** The range of `mark` (an anchor or a tag) before `range` on its line: a node's own range starts after its properties. */
function propertyRange(ctx: Ctx, range: SourceRange, mark: string): SourceRange {
  let i = ctx.text.lastIndexOf(mark, range.offset);
  if (i < 0) return range;
  // the whole property token: `!!str` starts at its first `!`
  while (i > 0 && !/\s/.test(ctx.text[i - 1] ?? ' ')) i--;
  return rangeFrom(ctx.lines, i, i + mark.length);
}

/** Report an anchor or a tag on `node`. */
function checkProperties(node: Node, ctx: Ctx, range: SourceRange): void {
  if (node.anchor) syntax(ctx, propertyRange(ctx, range, `&${node.anchor}`), 'anchors are not FluxScript', `remove \`&${node.anchor}\``);
  if (node.tag) syntax(ctx, propertyRange(ctx, range, '!'), `tags are not FluxScript: ${node.tag}`, 'remove the tag');
}

/** A key as the author wrote it: a quoted or plain string as is, a key the core schema would read as a number or a boolean as its source text (`007`, not `7`). */
function keyText(key: Node | null, ctx: Ctx): string {
  if (!isScalar(key)) return '';
  if (typeof key.value === 'string') return key.value;
  return key.range ? ctx.text.slice(key.range[0], key.range[1]) : String(key.value);
}

/** The entries of a mapping, keys as text with their ranges. */
function mapEntries(node: YAMLMap, ctx: Ctx, range: SourceRange): YEntry[] {
  return node.items.map((pair) => {
    const key = pair.key as Node | null;
    const keyAt = key?.range?.[0] ?? range.offset;
    const keyRange = key?.range ? rangeFrom(ctx.lines, key.range[0], key.range[1]) : rangeFrom(ctx.lines, keyAt, keyAt);
    if (!isScalar(key)) syntax(ctx, keyRange, 'a key must be plain text');
    // a key's anchor or tag is refused like a value's (M12.8 review r2)
    else checkProperties(key, ctx, keyRange);
    return { key: keyText(key, ctx), keyRange, value: convert(pair.value as Node | null, ctx, key?.range?.[2] ?? keyAt) };
  });
}

/** A scalar's value as FluxScript keeps it: string, number, boolean or null. */
function scalarValue(node: Node): YScalar['value'] {
  const value = isScalar(node) ? node.value : null;
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : null;
}

/** The tree of a `yaml` node, reporting what FluxScript refuses. */
function convert(node: Node | null, ctx: Ctx, at: number): YNode {
  const range = node?.range ? rangeFrom(ctx.lines, node.range[0], node.range[1]) : rangeFrom(ctx.lines, at, at);
  if (node === null) return { kind: 'scalar', range, value: null };
  if (isAlias(node)) {
    syntax(ctx, range, 'aliases are not FluxScript', 'repeat the value instead of `*alias`');
    return { kind: 'scalar', range, value: null };
  }
  checkProperties(node, ctx, range);
  if (isMap(node)) return { kind: 'map', range, entries: mapEntries(node, ctx, range) };
  if (isSeq(node)) return { kind: 'seq', range, items: node.items.map((item) => convert(item as Node | null, ctx, range.end)) };
  return { kind: 'scalar', range, value: scalarValue(node) };
}

/**
 * Parse FluxScript text into a tree with source ranges. Never throws.
 *
 * @public
 */
export function parseFlux(text: string): ParseResult {
  const lines = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lines, keepSourceTokens: true, uniqueKeys: true, prettyErrors: false, schema: 'core', version: '1.2' });
  const ctx: Ctx = { lines, diagnostics: [], text };
  // a tag is reported once, by checkProperties: yaml's own warning about it would repeat it
  for (const e of [...doc.errors, ...doc.warnings.filter((w) => w.code !== 'TAG_RESOLVE_FAILED')]) {
    const [start, end] = e.pos;
    const duplicate = e.code === 'DUPLICATE_KEY';
    syntax(
      ctx,
      rangeFrom(lines, start, end),
      duplicate ? 'a key is used twice in the same mapping' : (e.message.split('\n')[0] ?? e.message),
      duplicate ? 'keep one of them' : undefined,
    );
  }
  if (doc.errors.some((e) => e.code !== 'DUPLICATE_KEY')) return { diagnostics: ctx.diagnostics };
  const root = convert(doc.contents as Node | null, ctx, 0);
  return { root, diagnostics: ctx.diagnostics };
}
