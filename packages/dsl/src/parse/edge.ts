// The edge shorthand of FluxScript (ADR-0030, FR-DSL-001): `<end> <op> <end>`, where an end is a slug with an optional anchor suffix
// (`api.e`, `db.out-1`) and the op one of `->`, `<-`, `<->`, `--`, `~>`. Hand-written, so a malformed edge is reported at its column
// with a fix (FR-DSL-006). The value after the edge's `:` (a label or an object) is YAML, read by the parse stage.
import { toSlug } from '../resolve/suggest.js';
import type { DslDiagnostic, SourceRange } from '../types.js';

/**
 * The five edge ops of `flux: 1`, in ADR-0030's order.
 *
 * @public
 */
export const EDGE_OPS: readonly ['->', '<-', '<->', '--', '~>'] = ['->', '<-', '<->', '--', '~>'];

/**
 * An edge op.
 *
 * @public
 */
export type EdgeOp = (typeof EDGE_OPS)[number];

/**
 * One end of an edge: a slug, an optional anchor, and the 1-based column it starts at.
 *
 * @public
 */
export type EdgeEnd = {
  /** The node's slug. */
  readonly slug: string;
  /** `n`, `e`, `s`, `w` or a named anchor of the node's shape. */
  readonly anchor?: string;
  /** Column of the end in the edge text (1-based). */
  readonly col: number;
};

/**
 * A tokenized edge.
 *
 * @public
 */
export type Edge = {
  /** The source end, written first. */
  readonly from: EdgeEnd;
  /** The op. */
  readonly op: EdgeOp;
  /** The target end. */
  readonly to: EdgeEnd;
};

/**
 * A tokenized edge, or why the text is not one (its column, a message and a fix).
 *
 * @public
 */
export type EdgeResult =
  | {
      /** Tokenized. */
      readonly ok: true;
      /** The edge. */
      readonly edge: Edge;
    }
  | {
      /** Not an edge. */
      readonly ok: false;
      /** `FLX_DSL_BAD_SLUG` for an end whose slug breaks the slug rule, else `FLX_DSL_EDGE_SYNTAX`. */
      readonly code: 'FLX_DSL_EDGE_SYNTAX' | 'FLX_DSL_BAD_SLUG';
      /** In the object form, the key whose value is wrong; the column then counts inside that value. */
      readonly field?: 'from' | 'to' | 'op';
      /** Column of the problem (1-based). */
      readonly col: number;
      /** What is wrong. */
      readonly message: string;
      /** How to fix it. */
      readonly hint: string;
    };

const SLUG = /^[a-z][a-z0-9-]*$/;
type Field = 'from' | 'to' | 'op';
const fail = (col: number, message: string, hint: string, field?: Field): EdgeResult => ({
  ok: false,
  code: 'FLX_DSL_EDGE_SYNTAX',
  col,
  message,
  hint,
  ...(field ? { field } : {}),
});
const badSlug = (col: number, message: string, hint: string, field?: Field): EdgeResult => ({
  ok: false,
  code: 'FLX_DSL_BAD_SLUG',
  col,
  message,
  hint,
  ...(field ? { field } : {}),
});
/** The fix for a bad slug: a valid one made from it, or the rule when none can be. */
const slugHint = (slug: string): string => {
  const fixed = toSlug(slug);
  return fixed === undefined ? 'a slug starts with a letter: `api`, `db-main`' : `write it as "${fixed}"`;
};
/** Whether `word` holds an op glued between two ends (`web--api`, `a->b`). */
const glued = (word: string) => EDGE_OPS.some((op) => word.slice(1, -1).includes(op));

/** The whitespace-separated words of `text` with their 1-based columns. */
function words(text: string): { readonly word: string; readonly col: number }[] {
  return [...text.matchAll(/\S+/g)].map((m) => ({ word: m[0], col: (m.index ?? 0) + 1 }));
}

/** The op nearest to `word` by shared characters, for the hint. */
const nearestOp = (word: string): EdgeOp =>
  [...EDGE_OPS].sort((a, b) => [...b].filter((c) => word.includes(c)).length - [...a].filter((c) => word.includes(c)).length)[0] as EdgeOp;

/** One end, or why it is not one. */
function end(word: string, col: number, field?: Field): EdgeEnd | EdgeResult {
  const dot = word.indexOf('.');
  const slug = dot < 0 ? word : word.slice(0, dot);
  const anchor = dot < 0 ? undefined : word.slice(dot + 1);
  if (glued(word) && !SLUG.test(word)) return fail(col, `"${word}" is not a slug`, 'put spaces around the op: `a -> b`', field);
  if (!SLUG.test(slug)) return badSlug(col, `"${slug}" is not a slug: lower-case letters, digits and "-", starting with a letter`, slugHint(slug), field);
  if (anchor !== undefined && !SLUG.test(anchor))
    return fail(
      col,
      anchor === '' ? `"${word}" has a dot but no anchor` : `"${anchor}" is not an anchor`,
      'an anchor is n, e, s, w or a named anchor in lower case, after a dot: `api.e`',
      field,
    );
  return { slug, ...(anchor === undefined ? {} : { anchor }), col };
}

/** A one-word edge: a bad end, or an op glued between two ends (a slug may hold "-", so `web--api` is one slug), or too short. */
function oneWord(word: string, col: number): EdgeResult {
  const only = end(word, col);
  if ('ok' in only) return only;
  return glued(word)
    ? fail(col, `"${word}" is one word, not an edge`, 'put spaces around the op: `web -- api`')
    : fail(col, 'an edge needs two ends and an op', 'write `<from> <op> <to>`, e.g. `web -> api`');
}

/**
 * Tokenize the edge shorthand `text` (the key of an edge entry).
 *
 * @public
 */
export function parseEdge(text: string): EdgeResult {
  const parts = words(text);
  const [a, op, b, extra] = parts;
  if (a === undefined) return fail(1, 'an edge is empty', 'write `<from> <op> <to>`, e.g. `web -> api`');
  if ((EDGE_OPS as readonly string[]).includes(a.word)) return fail(a.col, 'an edge starts with its source end', 'write `<from> <op> <to>`, e.g. `web -> api`');
  if (parts.length === 1) return oneWord(a.word, a.col);
  if (op === undefined || b === undefined) return fail(op?.col ?? a.col, 'an edge needs two ends and an op', 'write `<from> <op> <to>`, e.g. `web -> api`');
  if (extra !== undefined) return fail(extra.col, 'an edge has more than two ends', 'write one edge per entry: `a -> b` and `b -> c`');
  if (!(EDGE_OPS as readonly string[]).includes(op.word))
    return fail(op.col, `"${op.word}" is not an edge op`, `did you mean "${nearestOp(op.word)}"? (ops: ${EDGE_OPS.join(' ')})`);
  const from = end(a.word, a.col);
  if ('ok' in from) return from;
  const to = end(b.word, b.col);
  if ('ok' in to) return to;
  return { ok: true, edge: { from, op: op.word as EdgeOp, to } };
}

/**
 * A failed edge as a diagnostic (`FLX_DSL_EDGE_SYNTAX`, or `FLX_DSL_BAD_SLUG` for a bad slug), placed at its column inside `key`: the
 * source range of the edge text, or in the object form of the failing field's value, on one line.
 *
 * @public
 */
export function edgeDiagnostic(failure: Extract<EdgeResult, { ok: false }>, key: SourceRange, path: string): DslDiagnostic {
  const at = key.offset + failure.col - 1;
  const col = key.col + failure.col - 1;
  return {
    code: failure.code,
    severity: 'error',
    path,
    message: failure.message,
    hint: failure.hint,
    source: { line: key.line, col, endLine: key.line, endCol: col + 1, offset: at, end: at + 1 },
  };
}

/** One end of the object form, or why it is not one. */
function objectEnd(value: unknown, field: 'from' | 'to'): EdgeEnd | EdgeResult {
  if (typeof value !== 'string' || value.trim() === '')
    return fail(1, `"${field}" must name an end`, `write ${field}: <slug> or ${field}: <slug>.<anchor>`, field);
  const parts = words(value);
  if (parts.length !== 1) return fail(parts[1]?.col ?? 1, `"${field}" holds more than one end`, `write one slug: ${field}: api`, field);
  return end(parts[0]?.word ?? '', parts[0]?.col ?? 1, field);
}

/**
 * Tokenize the object form of an edge, `{ from, to, op? }` (ADR-0030); `op` defaults to `->`. Other keys (`label`, `style`, `route`)
 * are read by the later stages.
 *
 * @public
 */
export function parseEdgeObject(value: { readonly from?: unknown; readonly to?: unknown; readonly op?: unknown }): EdgeResult {
  const op = value.op ?? '->';
  if (typeof op !== 'string' || !(EDGE_OPS as readonly string[]).includes(op)) {
    const word = String(op);
    return fail(1, `"${word}" is not an edge op`, `did you mean "${nearestOp(word)}"? (ops: ${EDGE_OPS.join(' ')})`, 'op');
  }
  const from = objectEnd(value.from, 'from');
  if ('ok' in from) return from;
  const to = objectEnd(value.to, 'to');
  if ('ok' in to) return to;
  return { ok: true, edge: { from, op: op as EdgeOp, to } };
}
