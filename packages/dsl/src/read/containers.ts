// The read stage's keys for master screens, placeholders, tables and frames (ADR-0219): a table's rows of cells, a frame's flag, box and
// clip, a screen's role and master, each typed and located with its diagnostics.
import { isYScalar, isYSeq, type YEntry, type YNode } from '../parse/parse.js';
import type { GroupAst, Located, NodeAst, ScreenAst, TableAst, TableCellAst } from './ast.js';
import { asMap, type Ctx, entries, pin, report, slug, text } from './fields.js';

/** The keys of a `table:` mapping. */
const TABLE_KEYS = { compiled: ['rows', 'widths', 'heights', 'tableStyle'], deferred: [] as string[] } as const;
/** The keys of a cell written as a mapping. */
const CELL_KEYS = { compiled: ['text', 'rowSpan', 'colSpan'], deferred: [] as string[] } as const;
/** The most rows or columns a table holds (ADR-0054). */
const GRID_MAX = 500;

type Says = { readonly path: string; readonly message: string; readonly hint?: string };

const invalid = (ctx: Ctx, n: YNode, { path, message, hint }: Says) =>
  report(ctx, { code: 'FLX_SCHEMA_INVALID', range: n.range, path, message, ...(hint ? { hint } : {}) });

/** `true` or `false`, or a type error. */
export function bool(ctx: Ctx, e: YEntry | undefined, path: string): Located<boolean> | undefined {
  if (e === undefined) return undefined;
  if (isYScalar(e.value) && typeof e.value.value === 'boolean') return { value: e.value.value, range: e.value.range };
  invalid(ctx, e.value, { path: `${path}/${e.key}`, message: `${e.key} is true or false` });
  return undefined;
}

/** A whole number of at least 1, or a type error. */
function count(ctx: Ctx, n: YNode, path: string): number | undefined {
  if (isYScalar(n) && typeof n.value === 'number' && Number.isInteger(n.value) && n.value >= 1) return n.value;
  invalid(ctx, n, { path, message: 'a span is a whole number of at least 1' });
  return undefined;
}

/** One cell: text, `null` (no cell), or `{ text, rowSpan, colSpan }`. */
function cell(ctx: Ctx, n: YNode, path: string): TableCellAst | null {
  if (isYScalar(n)) return n.value === null ? null : { text: String(n.value) };
  const m = asMap(ctx, n, path, 'a cell');
  if (!m) return null;
  const f = entries(ctx, m, CELL_KEYS, { path, pointer: '' });
  const t = text(ctx, f.get('text'), path);
  const spans = (['rowSpan', 'colSpan'] as const).flatMap((k) => {
    const v = f.get(k);
    const c = v && count(ctx, v.value, `${path}/${k}`);
    return c === undefined || c === 1 ? [] : [[k, c] as const];
  });
  return { ...(t ? { text: t.value } : {}), ...Object.fromEntries(spans) };
}

/** Positive weights, or a type error. */
function weights(ctx: Ctx, e: YEntry | undefined, path: string): number[] | undefined {
  if (e === undefined) return undefined;
  const ok = isYSeq(e.value) && e.value.items.every((x) => isYScalar(x) && typeof x.value === 'number' && x.value > 0 && Number.isFinite(x.value));
  if (ok && isYSeq(e.value) && e.value.items.length > 0) return e.value.items.map((x) => (isYScalar(x) ? (x.value as number) : 0));
  invalid(ctx, e.value, { path: `${path}/${e.key}`, message: `${e.key} is a list of positive weights`, hint: `${e.key}: [2, 1]` });
  return undefined;
}

/** The rows of a table, or undefined (and a diagnostic) when `rows` is not a list of lists. */
function rowsOf(ctx: Ctx, list: YNode | undefined, at: string, m: YNode): TableAst['rows'] | undefined {
  if (isYSeq(list) && list.items.length > 0 && list.items.every(isYSeq))
    return list.items.map((r, i) => (isYSeq(r) ? r.items.map((c, j) => cell(ctx, c, `${at}/rows/${i}/${j}`)) : []));
  invalid(ctx, list ?? m, { path: `${at}/rows`, message: 'rows is a list of rows, each a list of cells', hint: 'rows: [[Plan, Cost], [Build, 4 weeks]]' });
  return undefined;
}

/** What is wrong with a table's grid: its size, or weights that do not match its rows and columns. */
function gridProblem(t: TableAst, at: string): Says | undefined {
  const cols = columns(t);
  if (cols === 0 || cols > GRID_MAX || t.rows.length > GRID_MAX) return { path: at, message: `a table has 1 to ${GRID_MAX} rows and columns` };
  if (t.heights && t.heights.length !== t.rows.length) return { path: `${at}/heights`, message: 'heights has one weight per row' };
  if (t.widths && t.rows.some((r) => r.length > cols)) return { path: `${at}/widths`, message: 'a row has more cells than widths has columns' };
  return undefined;
}

/** A node's `table:`: rows of cells, with the weights and table style when given. */
export function table(ctx: Ctx, e: YEntry | undefined, path: string): NodeAst['table'] {
  const m = e && asMap(ctx, e.value, `${path}/table`, 'table');
  if (!m) return undefined;
  const at = `${path}/table`;
  const f = entries(ctx, m, TABLE_KEYS, { path: at, pointer: '' });
  const rows = rowsOf(ctx, f.get('rows')?.value, at, m);
  if (!rows) return undefined;
  const widths = weights(ctx, f.get('widths'), at);
  const heights = weights(ctx, f.get('heights'), at);
  const style = text(ctx, f.get('tableStyle'), at);
  const value: TableAst = {
    rows,
    ...(widths ? { widths } : {}),
    ...(heights ? { heights } : {}),
    ...(style ? { tableStyle: style.value } : {}),
  };
  const problem = gridProblem(value, at);
  if (problem) {
    invalid(ctx, m, problem);
    return undefined;
  }
  return { value, range: m.range };
}

/** The column count of a table: its widths', else its longest row's. */
export const columns = (t: TableAst): number => t.widths?.length ?? Math.max(0, ...t.rows.map((r) => r.length));

/** A node's placeholder, fills and table, with a table beside a shape, text or label reported. */
export function nodeExtras(ctx: Ctx, f: ReadonlyMap<string, YEntry>, path: string): Pick<NodeAst, 'table' | 'placeholder' | 'fills'> {
  const placeholder = text(ctx, f.get('placeholder'), path);
  const fills = text(ctx, f.get('fills'), path);
  const t = table(ctx, f.get('table'), path);
  const both = ['shape', 'text', 'label'].find((k) => f.has(k));
  const entry = f.get('table');
  if (entry && both)
    report(ctx, { code: 'FLX_SCHEMA_INVALID', range: entry.keyRange, path: `${path}/table`, message: `a table node has no ${both}`, hint: 'drop one of them' });
  return {
    ...(placeholder ? { placeholder } : {}),
    ...(fills && slug(ctx, fills.value, fills.range, `${path}/fills`) ? { fills } : {}),
    ...(t ? { table: t } : {}),
  };
}

/** A group's frame keys: `frame: true` with its pin and clip; a pin or clip on a group that is not a frame is reported. */
export function frameExtras(ctx: Ctx, f: ReadonlyMap<string, YEntry>, path: string): Pick<GroupAst, 'frame' | 'clip' | 'pin'> {
  const frame = bool(ctx, f.get('frame'), path);
  const clip = bool(ctx, f.get('clip'), path);
  const box = pin(ctx, f.get('pin'), path);
  if (frame?.value !== true) {
    for (const k of ['pin', 'clip']) {
      const e = f.get(k);
      if (e)
        report(ctx, {
          code: 'FLX_SCHEMA_INVALID',
          range: e.keyRange,
          path: `${path}/${k}`,
          message: `${k} is a frame's: a group is sized by its members`,
          hint: 'frame: true',
        });
    }
    // `frame: false` is a plain group
    return {};
  }
  if (box?.value.w === undefined || box.value.h === undefined) {
    const at = f.get('frame') as YEntry;
    report(ctx, {
      code: 'FLX_SCHEMA_INVALID',
      range: at.keyRange,
      path: `${path}/pin`,
      message: 'a frame needs a pin with w and h',
      hint: 'pin: { x: 100, y: 100, w: 600, h: 400 }',
    });
    return {};
  }
  return { frame, pin: box, ...(clip ? { clip } : {}) };
}

/** A screen's role and master. */
export function screenExtras(ctx: Ctx, f: ReadonlyMap<string, YEntry>, path: string): Pick<ScreenAst, 'role' | 'master'> {
  const role = text(ctx, f.get('role'), path);
  const master = text(ctx, f.get('master'), path);
  if (role && role.value !== 'master')
    report(ctx, { code: 'FLX_SCHEMA_INVALID', range: role.range, path: `${path}/role`, message: `"${role.value}" is not a role`, hint: 'role: master' });
  return {
    ...(role?.value === 'master' ? { role: role as Located<'master'> } : {}),
    ...(master && slug(ctx, master.value, master.range, `${path}/master`) ? { master } : {}),
  };
}
