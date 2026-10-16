// The diagnostics formatter for people and models (06-ai-authoring.md §4, FR-DSL-006, FR-AI-004): ranked (errors first, then by source
// position), deduplicated (one line per root cause: the same code at the same place with the same message) and capped (+N more).
import type { DslDiagnostic } from '../types.js';

const RANK = { error: 0, warning: 1, info: 2 } as const;

/** What to try for a code whose diagnostic carries no hint of its own, so an agent always gets a next step (FR-AI-004). */
const DEFAULT_HINTS: { readonly [code: string]: string } = {
  FLX_DSL_SYNTAX: 'fix the YAML at this line; use plain mappings with no anchors, tags or duplicate keys',
  FLX_DSL_VERSION: 'start the file with `flux: 1`',
  FLX_DSL_BAD_SLUG: 'use lower-case letters, digits and "-", starting with a letter',
  FLX_DSL_DUP_SLUG: 'give each node in a screen its own slug',
  FLX_DSL_UNKNOWN_KEY: 'remove the key or check its spelling against the cheat sheet',
  FLX_DSL_UNKNOWN_SHAPE: 'pick a shape from the catalog',
  FLX_DSL_EDGE_SYNTAX: 'write an edge as `a -> b` or `a ~> b`, with an optional `: label`',
  FLX_REF_MISSING: 'name a node or group that exists in the same screen',
  FLX_SCHEMA_INVALID: 'change the value to one the schema accepts; the message says which bound it broke',
};
const hintOf = (d: DslDiagnostic): string | undefined =>
  d.hint ?? (d.severity === 'error' ? (DEFAULT_HINTS[d.code] ?? 'see the code in the diagnostics docs') : undefined);
const where = (d: DslDiagnostic) => (d.source ? `L${d.source.line}:${d.source.col}` : d.path);

/** -1, 0 or 1: `a` before `b` by severity, then line, then column, then path. */
function byRank(a: DslDiagnostic, b: DslDiagnostic): number {
  const keys = (d: DslDiagnostic) => [RANK[d.severity], d.source?.line ?? Number.MAX_SAFE_INTEGER, d.source?.col ?? 0] as const;
  const [ka, kb] = [keys(a), keys(b)];
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return (ka[i] as number) < (kb[i] as number) ? -1 : 1;
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

/**
 * `diagnostics` as lines `L<line>:<col>  <severity> <code>  <message> — hint: <hint>`, ranked, deduplicated and capped at `cap`
 * (default 20) with a last line `+N more`.
 *
 * @public
 */
export function formatDiagnostics(diagnostics: readonly DslDiagnostic[], { cap = 20 }: { readonly cap?: number } = {}): string[] {
  const seen = new Set<string>();
  const unique = [...diagnostics].sort(byRank).filter((d) => {
    const key = `${d.code} ${where(d)} ${d.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const lines = unique.slice(0, cap).map((d) => `${where(d)}  ${d.severity.padEnd(7)} ${d.code}  ${d.message}${hintOf(d) ? ` — hint: ${hintOf(d)}` : ''}`);
  return unique.length > cap ? [...lines, `+${unique.length - cap} more`] : lines;
}
