// The diagnostics formatter for people and models (06-ai-authoring.md §4, FR-DSL-006, FR-AI-004): ranked (errors first, then by source
// position), deduplicated (one line per root cause: the same code at the same place with the same message) and capped (+N more).
import type { DslDiagnostic } from '../types.js';

const RANK = { error: 0, warning: 1, info: 2 } as const;
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
  const lines = unique.slice(0, cap).map((d) => `${where(d)}  ${d.severity.padEnd(7)} ${d.code}  ${d.message}${d.hint ? ` — hint: ${d.hint}` : ''}`);
  return unique.length > cap ? [...lines, `+${unique.length - cap} more`] : lines;
}
