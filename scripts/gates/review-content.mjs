// The rebase-stable identity a review verdict is bound to (ADR-0195). A verdict must survive
// a rebase that only moves the change onto a newer main, and must not survive any edit to what
// the reviewer saw. So the identity hashes the diff minus loop bookkeeping and generated reports,
// with only line numbers and blob ids dropped (whitespace kept: `git patch-id` would ignore it),
// plus the spec cells of each changed backlog row and the hand-written traceability cells.
import { createHash } from 'node:crypto';
import { git } from './lib.mjs';

/** Loop bookkeeping: written after review (verdicts, argued lines) or by the driver. */
export const BOOKKEEPING_PATHS = ['.harness/progress.md', '.harness/state.json', '.harness/reviews/**', '.harness/baselines/review-argued.txt'];
/** Regenerated from code and checked by check-api on every commit. */
export const GENERATED_PATHS = ['packages/*/api/*.api.md', 'packs/*/api/*.api.md', 'apps/*/api/*.api.md'];
export const BACKLOG = 'docs/backlog/current.md';
/** Hand-written except its last (Tests) column, which check-trace --write regenerates. */
export const TRACE = 'docs/requirements/40-traceability.md';
const STATE_COLS = [6, 7]; // | ID | Task | Req | Acceptance | Deps | State | Commit |  → split indices
const EXCLUDED = [...BOOKKEEPING_PATHS, ...GENERATED_PATHS, BACKLOG, TRACE].map((p) => `:(exclude,glob)${p}`);

const show = (rev, path) => {
  const r = git(['show', `${rev}:${path}`]);
  return r.status === 0 ? r.stdout : '';
};

/** Backlog rows by ID, with State/Commit cells blanked except a change to `descoped` (a scope decision). */
function specRows(text) {
  const rows = new Map();
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split('|');
    const id = /^\s*(M\d+\.\d+)\s*$/.exec(cells[1] ?? '')?.[1];
    if (!id) continue;
    rows.set(
      id,
      cells.map((c, i) => (STATE_COLS.includes(i) && !(i === 6 && /^\s*descoped\b/.test(c)) ? '' : c.trim())),
    );
  }
  return rows;
}

/** Each backlog row whose spec cells differ, as `ID before → after`, sorted by ID. */
export function backlogSpecDelta(before, after) {
  const a = specRows(before);
  const b = specRows(after);
  const ids = [...new Set([...a.keys(), ...b.keys()])].sort();
  return ids
    .filter((id) => (a.get(id) ?? []).join('|') !== (b.get(id) ?? []).join('|'))
    .map((id) => `${id} ${(a.get(id) ?? []).join('|')} → ${(b.get(id) ?? []).join('|')}`)
    .join('\n');
}

/** Traceability lines with each matrix row's generated Tests cell dropped. */
function traceLines(text) {
  return text.split(/\r?\n/).map((line) => {
    const cells = line.split('|');
    return /^\s*(FR|NFR)-[A-Z0-9]+-\d+\s*$/.test(cells[1] ?? '') ? cells.slice(0, -2).join('|') : line;
  });
}

/** The lines removed and added between two texts, as a sorted multiset: unchanged by edits elsewhere in the file. */
export function lineDelta(before, after) {
  const count = new Map();
  for (const l of before) count.set(l, (count.get(l) ?? 0) - 1);
  for (const l of after) count.set(l, (count.get(l) ?? 0) + 1);
  return [...count]
    .filter(([, n]) => n !== 0)
    .map(([l, n]) => `${n > 0 ? '+' : '-'}${Math.abs(n)} ${l}`)
    .sort()
    .join('\n');
}

/** A diff without what a rebase alone changes: blob ids and hunk line numbers. Whitespace stays. */
export function normalizedDiff(diff) {
  return diff
    .split('\n')
    .filter((l) => !/^index [0-9a-f]+\.\.[0-9a-f]+/.test(l))
    .map((l) => (/^@@ -\d+(,\d+)? \+\d+(,\d+)? @@/.test(l) ? '@@' : l))
    .join('\n');
}

/** `git diff` arguments of the change: the staged index against HEAD, or one commit against its parent. */
const range = (commit) => (commit ? [`${commit}^`, commit] : ['--cached']);
const revs = (commit) => (commit ? [`${commit}^`, commit] : ['HEAD', '']);

/** Paths the change touches, excluding nothing. */
export function changedPaths(commit) {
  return git(['diff', '--name-only', '--no-renames', ...range(commit)])
    .stdout.split(/\r?\n/)
    .filter(Boolean);
}

/**
 * The content identity of the staged change (no argument) or of one commit. Empty when the
 * change touches only bookkeeping, generated reports and backlog State/Commit cells.
 */
export function contentId(commit) {
  const diff = git(['diff', '--binary', '--full-index', '--no-color', '--no-ext-diff', '--no-renames', ...range(commit), '--', '.', ...EXCLUDED]);
  if (diff.status !== 0) throw new Error(`git diff failed: ${diff.stderr.trim()}`);
  const patch = diff.stdout ? createHash('sha256').update(normalizedDiff(diff.stdout)).digest('hex') : '';
  const [before, after] = revs(commit);
  const backlog = backlogSpecDelta(show(before, BACKLOG), show(after, BACKLOG));
  const trace = lineDelta(traceLines(show(before, TRACE)), traceLines(show(after, TRACE)));
  if (!patch && !backlog && !trace) return '';
  return createHash('sha256').update(`content-v2\n${patch}\n${backlog}\n${trace}\n`).digest('hex');
}

/**
 * sha256 of a landed commit's diff as its reviewer saw it staged: `record` hashes the staged diff
 * before appending the digest line the commit then carries, so `.harness/reviews/**` is left out (M18.127 r1 F1).
 */
export function reviewedDiffHash(commit) {
  const diff = git(['diff', '--binary', '--no-color', '--no-ext-diff', `${commit}^`, commit, '--', '.', ':(exclude,glob).harness/reviews/**']);
  if (diff.status !== 0) throw new Error(`git diff failed: ${diff.stderr.trim()}`);
  return createHash('sha256').update(diff.stdout).digest('hex');
}

/** One digest line: task, diff sha256, round, verdict, reviewer, findings, content id (7th field since ADR-0195). */
export function parseDigest(text) {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [task, hash, round, verdict, reviewer, findings, content, bound] = line.split('\t');
      // a `rebind` line names the line it binds (1-based) in `bound:<n>` (M18.127)
      return {
        task,
        hash,
        round,
        verdict,
        reviewer,
        findings,
        content: content?.replace(/^content:/, '') ?? '',
        bound: Number(bound?.replace(/^bound:/, '')) || 0,
      };
    });
}

/** Reviewer field grammar `vendor:role[:posthoc]` (M18.127, cp14 F6); null when a line does not follow it. */
export function parseReviewer(reviewer) {
  const m = /^([a-z0-9][a-z0-9.-]*):([a-z0-9][a-z0-9.-]*)(?::(posthoc))?$/.exec(String(reviewer ?? ''));
  return m ? { vendor: m[1], role: m[2], posthoc: Boolean(m[3]) } : null;
}
/** Posthoc by the grammar; lines older than the grammar by their `:posthoc` suffix. */
export const isPosthoc = (reviewer) => parseReviewer(reviewer)?.posthoc ?? /:posthoc\b/.test(String(reviewer ?? ''));

/** The review round the next verdict for `task` is: one past the rounds since its last pass (tracked digest). */
export function nextRound(digest, task) {
  const mine = digest.filter((l) => l.task === task && l.verdict !== 'rebind');
  const lastPass = mine.findLastIndex((l) => l.verdict === 'pass');
  return mine.length - lastPass;
}
