// Definition checks beyond the schema (M5 cp1 F2): every template and expression of a definition
// parses and reads only the names its place allows, so a definition that validates evaluates (its
// step budget and caps aside). Failures keep their own codes (FLX_SHAPE_PATH, FLX_EXPR_*).
import type { Diagnostic } from '@fluxion/schema';
import { type Expr, parseExpr } from '../expr/expr.js';
import { parseTemplate, TemplateFailure } from './template.js';

/** A problem of one template or expression, at its path in the definition. */
export type DefinitionIssue = { readonly path: readonly (string | number)[]; readonly code: Diagnostic['code']; readonly message: string };

/**
 * The parts of a definition this module reads (a shape of `ShapeDef`, written here so shape-def.ts can
 * import this module without a cycle).
 */
type Checked = {
  readonly params?: { readonly [name: string]: { readonly type: string } } | undefined;
  readonly outline:
    | { readonly path: string }
    | { readonly polygon: { readonly n: string; readonly x: string; readonly y: string } }
    | { readonly points: string };
  readonly decorations?: readonly { readonly path: string }[] | undefined;
  readonly handles?: readonly { readonly x: string; readonly y: string }[] | undefined;
  readonly textRegions?:
    | readonly { readonly x: number | string; readonly y: number | string; readonly w: number | string; readonly h: number | string }[]
    | undefined;
};

type Place = { readonly at: readonly (string | number)[]; readonly allowed: ReadonlySet<string> };

/** The expressions directly inside `e`. */
function children(e: Expr): readonly Expr[] {
  if (e.node === 'neg') return [e.arg];
  if (e.node === 'bin') return [e.left, e.right];
  if (e.node === 'cond') return [e.test, e.then, e.otherwise];
  return e.node === 'call' ? e.args : [];
}

/** The names `e` reads, in order of first appearance. */
function namesOf(e: Expr, out: Set<string> = new Set()): Set<string> {
  if (e.node === 'id') out.add(e.name);
  for (const c of children(e)) namesOf(c, out);
  return out;
}

function unknownNames(e: Expr, src: string, place: Place): DefinitionIssue[] {
  return [...namesOf(e)]
    .filter((name) => !place.allowed.has(name))
    .map((name) => ({ path: place.at, code: 'FLX_EXPR_UNKNOWN', message: `"${name}" is not a name this expression may read, in "${src}"` }));
}

function expressionIssues(src: string, place: Place): DefinitionIssue[] {
  const r = parseExpr(src, place.at);
  return r.ok ? unknownNames(r.value, src, place) : [{ path: place.at, code: r.error.code, message: r.error.message }];
}

function templateIssues(src: string, place: Place): DefinitionIssue[] {
  try {
    return parseTemplate(src, place.at).flatMap((cmd) => cmd.args.flatMap((arg) => unknownNames(arg.expr, arg.src, place)));
  } catch (e) {
    // tzap disable next-line ConditionalExpression: parseTemplate throws nothing else; a bug would propagate
    if (!(e instanceof TemplateFailure)) throw e;
    return [{ path: place.at, code: e.diagnostic.code, message: e.diagnostic.message }];
  }
}

function outlineIssues(outline: Checked['outline'], base: ReadonlySet<string>): DefinitionIssue[] {
  if ('path' in outline) return templateIssues(outline.path, { at: ['outline', 'path'], allowed: base });
  if (!('polygon' in outline)) return [];
  // a polygon's vertices also read their index and count; the count reads neither
  const vertex = new Set([...base, 'i', 'n']);
  const { n, x, y } = outline.polygon;
  return [
    ...expressionIssues(n, { at: ['outline', 'polygon', 'n'], allowed: base }),
    ...expressionIssues(x, { at: ['outline', 'polygon', 'x'], allowed: vertex }),
    ...expressionIssues(y, { at: ['outline', 'polygon', 'y'], allowed: vertex }),
  ];
}

/**
 * The problems of `def`'s templates and expressions: outline and decorations read `w`, `h`, `pi` and
 * the number, int and enum params; a polygon's vertices add `i` and `n`; handles and text regions read
 * what the outline reads.
 */
export function definitionIssues(def: Checked): DefinitionIssue[] {
  const scalars = Object.entries(def.params ?? {}).filter(([, p]) => p.type !== 'points');
  const base = new Set(['w', 'h', 'pi', ...scalars.map(([name]) => name)]);
  return [
    ...outlineIssues(def.outline, base),
    ...(def.decorations ?? []).flatMap((d, k) => templateIssues(d.path, { at: ['decorations', k, 'path'], allowed: base })),
    ...(def.handles ?? []).flatMap((h, k) => [
      ...expressionIssues(h.x, { at: ['handles', k, 'x'], allowed: base }),
      ...expressionIssues(h.y, { at: ['handles', k, 'y'], allowed: base }),
    ]),
    ...(def.textRegions ?? []).flatMap((r, k) =>
      (['x', 'y', 'w', 'h'] as const).flatMap((axis) => {
        const v = r[axis];
        return typeof v === 'string' ? expressionIssues(v, { at: ['textRegions', k, axis], allowed: base }) : [];
      }),
    ),
  ];
}
