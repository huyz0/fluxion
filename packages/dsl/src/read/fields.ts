// The read stage's field readers (ADR-0030): the key table, and typed, located values out of the parsed tree with their diagnostics.
import { isYMap, isYScalar, isYSeq, type YEntry, type YMap, type YNode } from '../parse/parse.js';
import { nearest } from '../resolve/suggest.js';
import type { DslDiagnostic, SourceRange } from '../types.js';
import type { LayoutAst, Located, NodeAst, StyleAst } from './ast.js';

/** The `flux: 1` key table (ADR-0030): compiled keys and kept-but-deferred keys at each level. */
export const KEYS = {
  top: { compiled: ['flux', 'title', 'theme', 'uses', 'screens'], deferred: ['vars', 'settings'] },
  theme: { compiled: ['preset', 'name', 'overrides'], deferred: ['mode', 'accent'] },
  screen: {
    compiled: ['id', 'title', 'layout', 'background', 'nodes', 'groups', 'edges', 'notes'],
    deferred: ['kind', 'steps', 'interactions', 'breakpoints', 'markdown', 'mermaid', 'raw'],
  },
  node: { compiled: ['shape', 'text', 'label', 'tone', 'style', 'pin', 'alt'], deferred: ['component', 'image', 'icon', 'badge', 'props', 'near'] },
  group: { compiled: ['label', 'contains', 'style', 'layout'], deferred: [] as string[] },
  edge: { compiled: ['from', 'to', 'op', 'label', 'style', 'route'], deferred: ['flow', 'riders'] },
  pin: { compiled: ['x', 'y', 'w', 'h'], deferred: [] as string[] },
} as const;

const SLUG = /^[a-z][a-z0-9-]*$/;
const STROKES = new Set(['solid', 'dashed', 'dotted']);

/** Where a mapping is: its diagnostic path and its pointer for kept sections. */
export type Where = { readonly path: string; readonly pointer: string };

export type Ctx = { readonly text: string; readonly diagnostics: DslDiagnostic[]; readonly deferred: { [pointer: string]: string } };
type Table = { readonly compiled: readonly string[]; readonly deferred: readonly string[] };

/** A problem to report: its code, place, pointer, message, fix and severity (error unless said). */
export type Problem = {
  readonly code: DslDiagnostic['code'];
  readonly range: SourceRange;
  readonly path: string;
  readonly message: string;
  readonly hint?: string | undefined;
  readonly severity?: DslDiagnostic['severity'];
};

export function report(ctx: Ctx, p: Problem): void {
  ctx.diagnostics.push({
    code: p.code,
    severity: p.severity ?? 'error',
    path: p.path,
    message: p.message,
    source: p.range,
    ...(p.hint ? { hint: p.hint } : {}),
  });
}

export const textOf = (ctx: Ctx, n: YNode): string => ctx.text.slice(n.range.offset, n.range.end);

/** The compiled entries of `map` by key; deferred entries are kept by pointer with a warning, unknown keys are errors. */
export function entries(ctx: Ctx, map: YMap, table: Table, { path, pointer }: Where): Map<string, YEntry> {
  const out = new Map<string, YEntry>();
  for (const e of map.entries) {
    if (table.compiled.includes(e.key)) out.set(e.key, e);
    else if (table.deferred.includes(e.key)) {
      ctx.deferred[`${pointer}/${e.key}`] = textOf(ctx, e.value);
      report(ctx, {
        code: 'FLX_DSL_NOT_YET',
        range: e.keyRange,
        path: `${path}/${e.key}`,
        message: `"${e.key}" is kept but not compiled yet`,
        severity: 'warning',
      });
    } else {
      const near = nearest(e.key, [...table.compiled, ...table.deferred]);
      report(ctx, {
        code: 'FLX_DSL_UNKNOWN_KEY',
        range: e.keyRange,
        path: `${path}/${e.key}`,
        message: `"${e.key}" is not a key here`,
        hint: near ? `did you mean "${near}"?` : `keys here: ${table.compiled.join(', ')}`,
      });
    }
  }
  return out;
}

/** A scalar as text (numbers and booleans written as they read), or a type error. */
export function text(ctx: Ctx, e: YEntry | undefined, path: string): Located<string> | undefined {
  if (e === undefined) return undefined;
  if (isYScalar(e.value) && e.value.value !== null) return { value: String(e.value.value), range: e.value.range };
  report(ctx, { code: 'FLX_SCHEMA_INVALID', range: e.value.range, path: `${path}/${e.key}`, message: `"${e.key}" must be a single value` });
  return undefined;
}

export const asMap = (ctx: Ctx, n: YNode, path: string, what: string): YMap | undefined => {
  if (isYMap(n)) return n;
  report(ctx, { code: 'FLX_SCHEMA_INVALID', range: n.range, path: path, message: `${what} must be a mapping` });
  return undefined;
};

/** A slug or screen id, or FLX_DSL_BAD_SLUG. */
export function slug(ctx: Ctx, value: string, range: SourceRange, path: string): boolean {
  if (SLUG.test(value)) return true;
  report(ctx, {
    code: 'FLX_DSL_BAD_SLUG',
    range: range,
    path: path,
    message: `"${value}" is not a slug: lower-case letters, digits and "-", starting with a letter`,
  });
  return false;
}

export function style(ctx: Ctx, e: YEntry | undefined, path: string): Located<StyleAst> | undefined {
  if (e === undefined) return undefined;
  const n = e.value;
  if (isYScalar(n) && typeof n.value === 'string' && STROKES.has(n.value)) return { value: n.value as 'solid' | 'dashed' | 'dotted', range: n.range };
  if (isYMap(n)) {
    const out: { [key: string]: string | number | boolean } = {};
    for (const s of n.entries) {
      if (isYScalar(s.value) && s.value.value !== null) out[s.key] = s.value.value;
      else
        report(ctx, {
          code: 'FLX_SCHEMA_INVALID',
          range: s.value.range,
          path: `${path}/style/${s.key}`,
          message: `style ${s.key} must be a token name or a value`,
        });
    }
    return { value: out, range: n.range };
  }
  report(ctx, { code: 'FLX_SCHEMA_INVALID', range: n.range, path: `${path}/style`, message: 'style is token names by key, or solid, dashed or dotted' });
  return undefined;
}

export function layout(ctx: Ctx, e: YEntry | undefined, path: string): LayoutAst | undefined {
  const m = e && asMap(ctx, e.value, `${path}/layout`, 'layout');
  if (!m) return undefined;
  const type = m.entries.find((x) => x.key === 'type');
  const typeText = text(ctx, type, `${path}/layout`);
  if (!typeText) {
    // a type of the wrong kind was already reported by text(); only a missing one is reported here
    if (type === undefined)
      report(ctx, {
        code: 'FLX_SCHEMA_INVALID',
        range: m.range,
        path: `${path}/layout/type`,
        message: 'a layout names its type',
        hint: 'layout: { type: stack }',
      });
    return undefined;
  }
  const options: { [key: string]: unknown } = {};
  for (const x of m.entries) if (x.key !== 'type') options[x.key] = plain(x.value);
  return { type: typeText, options };
}

/** A YNode as a plain value (for layout options). */
export function plain(n: YNode): unknown {
  if (isYScalar(n)) return n.value;
  if (isYSeq(n)) return n.items.map(plain);
  return Object.fromEntries(n.entries.map((e) => [e.key, plain(e.value)]));
}

export function pin(ctx: Ctx, e: YEntry | undefined, path: string): NodeAst['pin'] {
  const m = e && asMap(ctx, e.value, `${path}/pin`, 'pin');
  if (!m) return undefined;
  const fields = entries(ctx, m, KEYS.pin, { path: `${path}/pin`, pointer: '' });
  const num = (k: string) => {
    const v = fields.get(k)?.value;
    if (v === undefined) return undefined;
    if (isYScalar(v) && typeof v.value === 'number' && Number.isFinite(v.value)) return v.value;
    report(ctx, { code: 'FLX_SCHEMA_INVALID', range: v.range, path: `${path}/pin/${k}`, message: `pin ${k} must be a number` });
    return undefined;
  };
  const [x, y, w, h] = ['x', 'y', 'w', 'h'].map(num);
  if (x === undefined || y === undefined) {
    if (!fields.has('x') || !fields.has('y'))
      report(ctx, { code: 'FLX_SCHEMA_INVALID', range: m.range, path: `${path}/pin`, message: 'a pin needs x and y', hint: 'pin: { x: 100, y: 200 }' });
    return undefined;
  }
  return { value: { x, y, ...(w === undefined ? {} : { w }), ...(h === undefined ? {} : { h }) }, range: m.range };
}

/** A list of strings (`uses`, `contains`): each item located; a value that is not a list, or an item that is not a string, is an error. */
export function stringList(ctx: Ctx, n: YNode | undefined, path: string, hint: string): Located<string>[] {
  if (n === undefined) return [];
  if (!isYSeq(n)) {
    report(ctx, { code: 'FLX_SCHEMA_INVALID', range: n.range, path, message: `${path.split('/').at(-1)} is a list`, hint });
    return [];
  }
  return n.items.flatMap((item, i) => {
    if (isYScalar(item) && typeof item.value === 'string') return [{ value: item.value, range: item.range }];
    report(ctx, { code: 'FLX_SCHEMA_INVALID', range: item.range, path: `${path}/${i}`, message: 'each item is a name', hint });
    return [];
  });
}
