// Resolve checks for master screens and placeholders (ADR-0219): a screen's `master:` names a screen of the file with `role: master`, and a
// node's `fills:` names a node with a `placeholder` on its screen's master. Each miss is FLX_REF_MISSING with the nearest name.
import { DIAGNOSTIC_CODES } from '@fluxion/schema';
import type { FluxAst, Located, ScreenAst } from '../read/ast.js';
import type { DslDiagnostic } from '../types.js';
import { nearest } from './suggest.js';

const missing = (at: Located<string>, path: string, message: string, near: string | undefined): DslDiagnostic => ({
  code: 'FLX_REF_MISSING',
  severity: DIAGNOSTIC_CODES.FLX_REF_MISSING,
  path,
  message,
  source: at.range,
  ...(near ? { hint: `did you mean "${near}"?` } : {}),
});

/** The problems of one screen's `master:` and its nodes' `fills:`. */
function screenProblems(s: ScreenAst, i: number, masters: ReadonlyMap<string, ScreenAst>): DslDiagnostic[] {
  const out: DslDiagnostic[] = [];
  const master = s.master && masters.get(s.master.value);
  if (s.master && !master)
    out.push(
      missing(s.master, `/screens/${i}/master`, `"${s.master.value}" is not a master screen of this file`, nearest(s.master.value, [...masters.keys()])),
    );
  const slots = (master?.nodes ?? []).filter((n) => n.placeholder !== undefined).map((n) => n.slug.value);
  const where = master ? `master "${master.id.value}"` : 'a master of this screen';
  for (const n of s.nodes)
    if (n.fills && !slots.includes(n.fills.value))
      out.push(
        missing(n.fills, `/screens/${i}/nodes/${n.slug.value}/fills`, `"${n.fills.value}" is not a placeholder of ${where}`, nearest(n.fills.value, slots)),
      );
  return out;
}

/** The problems of the file's `master:` and `fills:` references. */
export function checkMasters(ast: FluxAst): DslDiagnostic[] {
  const masters = new Map(ast.screens.filter((s) => s.role !== undefined).map((s) => [s.id.value, s] as const));
  return ast.screens.flatMap((s, i) => screenProblems(s, i, masters));
}
