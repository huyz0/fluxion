// NFR-DX-003, NFR-MNT-005: diagnostics are never whole-run qualification receipts.
import { stripVTControlCharacters } from 'node:util';

/** Only pass mutants after the caller has validated the complete expected inventory. */
export function mutationDiagnostic({ label, mutants, error, details = [] }) {
  const lines = [`Mutation diagnostic (partial; not qualification): ${label}`];
  if (error) lines.push(`Failed: ${error}`, ...details);
  else if (mutants) {
    const counts = new Map();
    for (const mutant of mutants) counts.set(mutant.status, (counts.get(mutant.status) ?? 0) + 1);
    lines.push(
      `Counts: ${
        [...counts]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([status, count]) => `${status}: ${count}`)
          .join(', ') || 'none'
      }`,
    );
    const problems = mutants.filter((m) => ['Survived', 'NoCoverage', 'RuntimeError'].includes(m.status));
    for (const mutant of problems.slice(0, 25)) {
      const { line, column } = mutant.location.start;
      lines.push(`${mutant.status} ${mutant.id} — ${mutant.file}:${line}:${column}`);
    }
    if (problems.length > 25) lines.push(`[${problems.length - 25} more problem mutants; see raw tzap.json]`);
  }
  lines.push('Full evidence: raw tzap.json and shard.json; complete package floors are checked only by aggregation.');
  const text = stripVTControlCharacters(lines.join('\n'));
  const bounded = text.length > 16000 ? `${text.slice(0, 16000)}\n[diagnostic truncated; see raw evidence and normal logs]` : text;
  return `::${error ? 'error' : 'notice'}::${bounded.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`;
}

export function emitMutationDiagnostic(diagnostic) {
  if (process.env.GITHUB_ACTIONS === 'true') console.log(mutationDiagnostic(diagnostic));
}
