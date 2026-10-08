// The decompiler's YAML writer (FR-DSL-002, ADR-0030): a small tree of maps, sequences, scalars and raw source text, written in the
// FluxScript house style: 2-space indent, sequence items indented under their key, short maps in flow style (`{ shape: rect, label: API }`).
// A string is written plain when the `yaml` parser reads it back as the same string in block and flow context, else JSON-quoted (a JSON
// string is a YAML double-quoted scalar). Raw text (a deferred section, ADR-0031) is written as the author wrote it, re-indented only when
// its own indentation would not fit where it goes.
import { isMap, isSeq, parse, parseDocument } from 'yaml';

/**
 * Source text written as it is: a deferred section.
 *
 * @internal
 */
export type Raw = { readonly raw: string };

/** A mapping: entries in order, written in flow style when `flow` and every value fits one line; comment lines after the entries. */
export type OutMap = { readonly map: readonly (readonly [string, Out])[]; readonly flow?: boolean; readonly comments?: readonly string[] };

/** A sequence, written in flow style when `flow` and every item fits one line. */
export type OutSeq = { readonly seq: readonly Out[]; readonly flow?: boolean };

/** A value to write. */
export type Out = string | number | boolean | null | Raw | OutMap | OutSeq;

const PLAIN = /^[A-Za-z][\w .:/()+@<>~-]*$/;

/** Whether `s` reads back as itself when written plain, in a block mapping and in a flow sequence. */
function isPlain(s: string): boolean {
  if (!PLAIN.test(s) || s.endsWith(' ') || s.endsWith(':') || s.includes(': ') || s.includes('  ')) return false;
  try {
    return (parse(`k: ${s}`) as { k?: unknown }).k === s && (parse(`[${s}]`) as unknown[])[0] === s;
  } catch {
    return false;
  }
}

/** A scalar as YAML text. */
export function scalar(v: string | number | boolean | null): string {
  if (typeof v === 'string') return isPlain(v) ? v : JSON.stringify(v);
  return v === null ? 'null' : String(v);
}

const isRaw = (v: Out): v is Raw => typeof v === 'object' && v !== null && 'raw' in v;
const isOutMap = (v: Out): v is OutMap => typeof v === 'object' && v !== null && 'map' in v;
const isOutSeq = (v: Out): v is OutSeq => typeof v === 'object' && v !== null && 'seq' in v;

/** The lines of raw text, without the line break it may end with (the next line of the output gives it back). */
const rawLines = (raw: string): string[] => (raw.endsWith('\n') ? raw.slice(0, -1) : raw).split('\n');

/** Whether raw text is a block mapping or sequence (it goes on lines of its own), judged by its first line. */
function isBlockRaw(raw: string): boolean {
  const doc = parseDocument(rawLines(raw)[0] ?? '');
  if (doc.errors.length > 0) return false;
  const c = doc.contents;
  return (isMap(c) || isSeq(c)) && !c.flow;
}

/** Each element of `list` as one line, or undefined when one does not fit. */
function each<T>(list: readonly T[], one: (x: T) => string | undefined): string[] | undefined {
  const out: string[] = [];
  for (const x of list) {
    const s = one(x);
    if (s === undefined) return undefined;
    out.push(s);
  }
  return out;
}

/** A mapping in flow style on one line, or undefined. */
function inlineMap(v: OutMap): string | undefined {
  if (v.map.length === 0) return '{}';
  if (!v.flow || v.comments?.length) return undefined;
  const parts = each(v.map, ([k, x]) => {
    const s = inline(x);
    return s === undefined ? undefined : `${scalar(k)}: ${s}`;
  });
  return parts && `{ ${parts.join(', ')} }`;
}

/** A sequence in flow style on one line, or undefined. */
function inlineSeq(v: OutSeq): string | undefined {
  if (v.seq.length === 0) return '[]';
  const items = v.flow ? each(v.seq, inline) : undefined;
  return items && `[${items.join(', ')}]`;
}

/** `v` on one line (a scalar, single-line raw text, or a flow collection of such), or undefined when it needs lines of its own. */
function inline(v: Out): string | undefined {
  if (v === null || typeof v !== 'object') return scalar(v);
  if (isRaw(v)) return v.raw.includes('\n') || isBlockRaw(v.raw) ? undefined : v.raw;
  return isOutMap(v) ? inlineMap(v) : inlineSeq(v);
}

const leading = (line: string) => line.length - line.trimStart().length;
const significant = (line: string) => line.trim() !== '' && !line.trimStart().startsWith('#');

/** Lines moved right by `by` columns (left when negative, never past their first character); blank lines stay blank. */
function shift(lines: readonly string[], by: number): string[] {
  if (by === 0) return [...lines];
  return lines.map((l) => (l.trim() === '' ? l : by > 0 ? ' '.repeat(by) + l : l.slice(Math.min(-by, leading(l)))));
}

/** The column the first line of a block raw text had in its source: its siblings' column, or two left of a lone entry's content. */
function sourceIndent(lines: readonly string[]): number | undefined {
  const rest = lines.slice(1).filter(significant);
  if (rest.length === 0) return undefined;
  const m = Math.min(...rest.map(leading));
  const first = (lines[0] ?? '').replace(/\s#.*$/, '').trimEnd();
  const siblings = first.startsWith('-') ? rest.some((l) => leading(l) === m && l.trimStart().startsWith('-')) : !first.endsWith(':');
  return siblings ? m : m - 2;
}

/** Block raw text placed with its first line at column `at` (the caller writes what precedes that line). */
function placeBlock(raw: string, at: number): string[] {
  const lines = rawLines(raw);
  const from = sourceIndent(lines);
  return [lines[0] ?? '', ...shift(lines.slice(1), from === undefined ? 0 : at - from)];
}

/** Inline raw text after `key: ` at indent `ind`: its later lines (a block scalar, a long flow value) moved right when not deeper than the key. */
function placeInline(raw: string, ind: number): string[] {
  const lines = rawLines(raw);
  const rest = lines.slice(1);
  const deep = rest.filter((l) => l.trim() !== '');
  const m = deep.length > 0 ? Math.min(...deep.map(leading)) : ind + 2;
  return [lines[0] ?? '', ...shift(rest, m > ind ? 0 : ind + 2 - m)];
}

/** `key: value` at indent `ind`. */
function entryLines(key: string, v: Out, ind: number): string[] {
  const pad = ' '.repeat(ind);
  const k = scalar(key);
  if (isRaw(v)) {
    if (!isBlockRaw(v.raw)) {
      const [first = '', ...rest] = placeInline(v.raw, ind);
      return [`${pad}${k}: ${first}`, ...rest];
    }
    const [first = '', ...rest] = placeBlock(v.raw, ind + 2);
    return [`${pad}${k}:`, `${pad}  ${first}`, ...rest];
  }
  const one = inline(v);
  if (one !== undefined) return [`${pad}${k}: ${one}`];
  return [`${pad}${k}:`, ...blockLines(v as OutMap | OutSeq, ind + 2)];
}

/** A sequence item at indent `ind`: `- ` there, its content two columns right. */
function itemLines(v: Out, ind: number): string[] {
  const pad = ' '.repeat(ind);
  if (isRaw(v)) {
    const [first = '', ...rest] = isBlockRaw(v.raw) ? placeBlock(v.raw, ind + 2) : placeInline(v.raw, ind);
    return [`${pad}- ${first}`, ...rest];
  }
  const one = inline(v);
  if (one !== undefined) return [`${pad}- ${one}`];
  const [first = '', ...rest] = blockLines(v as OutMap | OutSeq, ind + 2);
  return [`${pad}- ${first.slice(ind + 2)}`, ...rest];
}

/** A block mapping or sequence at indent `ind`. */
export function blockLines(v: OutMap | OutSeq, ind: number): string[] {
  if (isOutSeq(v)) return v.seq.flatMap((x) => itemLines(x, ind));
  const pad = ' '.repeat(ind);
  return [...v.map.flatMap(([k, x]) => entryLines(k, x, ind)), ...(v.comments ?? []).map((c) => `${pad}# ${c}`)];
}

/** A sequence item at indent `ind`, as text with a final line break. */
export function itemText(v: Out, ind: number): string {
  return `${itemLines(v, ind).join('\n')}\n`;
}
