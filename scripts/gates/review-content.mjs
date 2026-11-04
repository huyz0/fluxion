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

/** The budget record names the commit it measured, which land.mjs renames like a Commit cell (M18.155, ADR-0205). */
export const BUDGET = '.harness/budget.json';
const BUDGET_COMMIT = /^([-+ ]\s*"commit":\s*")[0-9a-f]{7,40}(",?)$/;

/**
 * A diff without what a rebase alone changes: blob ids and hunk line numbers. Whitespace stays.
 * Unless `legacy`, the budget record's `commit` value is dropped too (ADR-0205).
 */
export function normalizedDiff(diff, { legacy = false } = {}) {
  let file = '';
  return diff
    .split('\n')
    .filter((l) => !/^index [0-9a-f]+\.\.[0-9a-f]+/.test(l))
    .map((l) => {
      if (l.startsWith('diff --git ')) file = l;
      if (/^@@ -\d+(,\d+)? \+\d+(,\d+)? @@/.test(l)) return '@@';
      return !legacy && file === `diff --git a/${BUDGET} b/${BUDGET}` ? l.replace(BUDGET_COMMIT, '$1<commit>$2') : l;
    })
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
export function contentId(commit, { legacy = false } = {}) {
  const diff = git(['diff', '--binary', '--full-index', '--no-color', '--no-ext-diff', '--no-renames', ...range(commit), '--', '.', ...EXCLUDED]);
  if (diff.status !== 0) throw new Error(`git diff failed: ${diff.stderr.trim()}`);
  const patch = diff.stdout ? createHash('sha256').update(normalizedDiff(diff.stdout, { legacy })).digest('hex') : '';
  const [before, after] = revs(commit);
  const backlog = backlogSpecDelta(show(before, BACKLOG), show(after, BACKLOG));
  const trace = lineDelta(traceLines(show(before, TRACE)), traceLines(show(after, TRACE)));
  if (!patch && !backlog && !trace) return '';
  return createHash('sha256').update(`content-v2\n${patch}\n${backlog}\n${trace}\n`).digest('hex');
}

/**
 * Every identity a verdict for this change may carry: the current one first, then the one from before
 * ADR-0205 when it differs (only a change to the budget record's `commit` line differs), so evidence
 * recorded before it still binds.
 */
export function contentIds(commit) {
  return [...new Set([contentId(commit), contentId(commit, { legacy: true })])];
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
        // a re-application of passed content on a new base keeps its round (M18.177)
        reapply: bound === 'reapply',
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

/**
 * The task's digest lines that have not landed (missing from `committed`, the parsed digest on the landed base), rebind lines left
 * out: the rounds of the change under review (M18.177); with `landed`, a task's landed lines close its rounds only once its own
 * commit is there (M18.231, cp34 F2).
 */
export function openLines(digest, task, { committed = [], landed } = {}) {
  const key = (l) => [l.task, l.hash, l.round, l.verdict, l.reviewer, l.content].join('\t');
  // lines another row's commit carried onto the base close nothing while `task` has no commit there (M18.231, cp34 F2)
  const closed = landed === undefined || landed.has(task);
  const before = new Set(closed ? committed.filter((l) => l.task === task).map(key) : []);
  return digest.filter((l) => l.task === task && l.verdict !== 'rebind' && !before.has(key(l)));
}

/**
 * The round of the next verdict for `task` over `content`, numbered from the tracked digest's lines for
 * the task that have not landed (missing from `committed`, the parsed digest on the landed base): one past
 * the highest of them, so a pass never restarts the count before the task's commit and the round cap
 * counts changes-requested rounds after a pass; content that already passed among them is a
 * re-application on a new base and keeps that round, marked `reapply` (M18.177, cp23 F1). With `landed`, the tasks
 * that have a commit on the landed base, a task's landed lines close its rounds only once its own commit is there (M18.231).
 */
export function nextRound(digest, task, { content = '', committed = [], landed } = {}) {
  const since = openLines(digest, task, { committed, landed });
  const passed = content ? since.findLast((l) => l.verdict === 'pass' && l.content === content) : undefined;
  const number = (l) => Number(/^r(\d+)$/.exec(l.round)?.[1]) || 0;
  if (passed) return { round: number(passed), reapply: true };
  return { round: Math.max(0, ...since.map(number)) + 1, reapply: false };
}

/**
 * The review rounds a text names for `task` (a commit body, a progress entry): every `r<N>` or `round <N>` (`rounds`), and those it
 * names as sent back (`sentBack`: `r<N> changes-requested`, a list of rounds before the word too), each sorted, read only from sentences that name no
 * other task, since those speak of other reviews, with a checkpoint reference and the round or finding right after it left out
 * (M18.259, cp40 F1). A sentence ends at `.` or `;`, and also at a
 * subject line, a blank line, a heading or a list item, so a subject or heading that names a checkpoint does not swallow the next
 * paragraph. Each round is held on its own, not only the highest (M18.268, cp42 F6). `{ rounds: [], sentBack: [] }` when it names none.
 */
export function namedRounds(text, task) {
  const own = (sentence) => [...sentence.matchAll(/\b(M\d+\.\d+)\b/g)].every((m) => m[1] === task);
  // a checkpoint reference and the round or finding it names (`cp40 r2`, `cp40's round 2 F1`) speak of the checkpoint's review; the
  // rest of the sentence still names the task's own rounds (M18.259 r5 F1)
  const ownText = (sentence) => sentence.replace(/\bcp\d+(?:'s)?(?:\s+(?:r|round )\d+)?(?:\s+F\d+)*/g, ' ');
  const blocks = [];
  let open = false;
  for (const [i, line] of String(text ?? '')
    .split(/\r?\n/)
    .entries()) {
    if (/^[A-Z][a-z]*(?:-[A-Za-z]+)+: /.test(line)) continue;
    if (!line.trim()) {
      open = false;
      continue;
    }
    const starts = i === 0 || !open || /^\s*(?:#|[-*] |\d+\. )/.test(line);
    if (starts) blocks.push(line);
    else blocks[blocks.length - 1] += ` ${line}`;
    // a subject line and a heading end where they end
    open = i !== 0 && !/^\s*#/.test(line);
  }
  const sentences = blocks
    .flatMap((b) => b.split(/[.;]\s+/))
    .filter(own)
    .map(ownText);
  const numbers = (t, re) => [...t.matchAll(re)].map((m) => Number(m[1]));
  const sentBack = /\b(?:r|round )\d+(?:\s*(?:,|and|,\s*and)\s*(?:r|round )?\d+)*\s+changes-requested\b/g;
  return {
    rounds: sortedSet(sentences.flatMap((t) => numbers(t, /\b(?:r|round )(\d+)\b/g))),
    // every number in a sent-back list: `r1 and r2 changes-requested` sends back both
    sentBack: sortedSet(sentences.flatMap((t) => [...t.matchAll(sentBack)].flatMap((m) => numbers(m[0], /(\d+)/g)))),
  };
}

const sortedSet = (ns) => [...new Set(ns)].sort((a, b) => a - b);

/** `named` from several texts as one: every round any names, and every round any sends back. */
export const mergeRounds = (all) => ({ rounds: sortedSet(all.flatMap((n) => n.rounds)), sentBack: sortedSet(all.flatMap((n) => n.sentBack)) });

/**
 * What `named` (from {@link namedRounds}) says happened that `lines` (the task's digest lines for this change) do not hold: a named
 * round with no line, or a round named as changes-requested that no changes-requested line holds; [] when the digest holds them all.
 * Each round is checked, so 'r1 changes-requested, r2 changes-requested, r3 pass' over lines r1 and r3 lacks r2 (M18.268, cp42 F6).
 */
export function missingRounds(named, lines) {
  const number = (l) => Number(/^r(\d+)$/.exec(l.round)?.[1]) || 0;
  const held = new Set(lines.map(number).filter(Boolean));
  const heldBack = new Set(lines.filter((l) => l.verdict === 'changes-requested').map(number));
  const list = (ns) => ns.map((n) => `r${n}`).join(', ');
  const plural = (ns) => (ns.length > 1 ? 's' : '');
  const lacking = named.rounds.filter((n) => !held.has(n));
  const notBack = named.sentBack.filter((n) => !heldBack.has(n));
  const missing = [];
  if (lacking.length)
    missing.push(
      `round${plural(lacking)} ${list(lacking)} (the text names ${lacking.length > 1 ? 'them' : 'it'}, the digest holds ${held.size ? list([...held].sort((a, b) => a - b)) : 'none'})`,
    );
  if (notBack.length)
    missing.push(
      `round${plural(notBack)} ${list(notBack)} as changes-requested (the text sends ${notBack.length > 1 ? 'them' : 'it'} back, no changes-requested line holds ${notBack.length > 1 ? 'them' : 'it'})`,
    );
  return missing;
}
