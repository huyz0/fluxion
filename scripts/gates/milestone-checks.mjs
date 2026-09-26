// Behavioural checks shared by milestone completion gates (M0 cp1 F1: a leg that only checks a
// file exists can be satisfied by a stub). Each returns true | '<reason>' for lib.mjs leg().
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, repoPath } from './lib.mjs';

/** Paths a commit may touch after the final review range without invalidating the review. */
export const BOOKKEEPING_PATHS = [/^\.harness\//, /^docs\/backlog\//, /^docs\/milestones\/(roadmap|M\d+)\.md$/];

/**
 * A dry-runs record must have, per tool, a Success and an Impossible section, each with a
 * non-empty `Date:`, `Outcome:` and `Transcript:` line — mentioning the words is not enough.
 */
const DRY_RUN_KINDS = ['Success', 'Impossible'];
const DRY_RUN_FIELDS = ['Date', 'Outcome', 'Transcript'];

/** Missing items of one `## <tool>` section (its Success/Impossible subsections and their fields). */
function dryRunGaps(tool, section) {
  const gaps = [];
  for (const kind of DRY_RUN_KINDS) {
    const sub = new RegExp(`^### ${kind}\\s*$([\\s\\S]*?)(?=^##|(?![\\s\\S]))`, 'm').exec(section)?.[1];
    if (!sub) gaps.push(`${tool} / ### ${kind}`);
    else gaps.push(...DRY_RUN_FIELDS.filter((f) => !new RegExp(`^${f}:[ \\t]*\\S`, 'm').test(sub)).map((f) => `${tool} / ${kind} / ${f}:`));
  }
  return gaps;
}

export function checkDryRuns(text, tools = ['Claude Code', 'Codex']) {
  const missing = tools.flatMap((tool) => {
    const section = new RegExp(`^## ${tool}\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm').exec(text)?.[1];
    return section ? dryRunGaps(tool, section) : [`## ${tool}`];
  });
  return missing.length === 0 || `missing ${missing.join(', ')}`;
}

/**
 * Cross-vendor reviewer smoke (M0.13): both directions attempted on a seeded defect, each with a
 * distinct diff hash whose verdict was recorded in the tracked digest (review.mjs record writes it)
 * FOR THIS TASK and BY THAT REVIEWER'S VENDOR, and at least one direction caught it. Reusing an
 * unrelated recorded review therefore cannot satisfy it.
 */
export function checkReviewerSmoke(record, digest = '', task = 'M0.13') {
  const runs = Array.isArray(record?.runs) ? record.runs : [];
  const pairs = new Set(runs.map((r) => `${r.author}->${r.reviewer}`));
  const bad = [];
  if (!(pairs.has('claude->codex') && pairs.has('codex->claude'))) bad.push('needs runs claude->codex and codex->claude');
  if (runs.some((r) => !r.seededDefect || !/^[0-9a-f]{64}$/.test(r.diff_sha256 ?? '') || typeof r.caught !== 'boolean'))
    bad.push('each run needs seededDefect, diff_sha256, caught');
  if (new Set(runs.map((r) => r.diff_sha256)).size !== runs.length) bad.push('each run needs its own diff_sha256');
  if (!runs.some((r) => r.caught === true)) bad.push('no direction caught the seeded defect');
  // digest columns: task, hash, round, verdict, reviewer, findings
  const lines = digest
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => l.split('\t'));
  const unrecorded = runs.filter(
    (r) => !lines.some(([t, h, , , reviewer = '']) => t === task && h === r.diff_sha256 && reviewer.split(/[-:@/ ]/)[0] === r.reviewer),
  );
  if (unrecorded.length) bad.push(`${unrecorded.length} run(s) have no ${task} verdict by that reviewer in .harness/reviews/digest.log`);
  return bad.length === 0 || bad.join('; ');
}

/**
 * Final milestone review: well-formed JSON for this milestone (reviewer, findings array, every
 * disposition names an action), every blocking/major finding dispositioned, and a range that
 * covers the WHOLE milestone: base strictly before the milestone's first commit, end at or after
 * its last non-bookkeeping commit.
 */
const DISPOSITIONS = ['reopen', 'hand-off', 'argue'];

/** Shape of a review record: reviewer, findings array, well-formed dispositions, none missing. */
function reviewShapeProblem(review, milestone) {
  if (!review || review.milestone !== milestone) return `review is not for ${milestone}`;
  if (typeof review.reviewer !== 'string' || !review.reviewer.trim()) return 'review has no reviewer';
  if (!Array.isArray(review.findings)) return 'findings must be an array';
  const dispositions = Array.isArray(review.dispositions) ? review.dispositions : [];
  if (dispositions.some((d) => !d.finding || !DISPOSITIONS.includes(d.disposition))) return `disposition needs finding and one of ${DISPOSITIONS.join('/')}`;
  const disposed = new Set(dispositions.map((d) => d.finding));
  const open = review.findings.filter((f) => ['blocking', 'major'].includes(f.severity) && !disposed.has(f.id));
  return open.length ? `undispositioned ${open.map((f) => f.id).join(', ')}` : null;
}

export function checkFinalReview(review, milestone) {
  const shape = reviewShapeProblem(review, milestone);
  if (shape) return shape;
  const m = /^([0-9a-f]{7,40})\.\.([0-9a-f]{7,40})$/.exec(review.range ?? '');
  if (!m) return 'range must be <base>..<sha>';
  return checkReviewRange(m[1], m[2], milestone);
}

/** base..end must be real commits of HEAD covering the whole milestone, then only bookkeeping. */
function checkReviewRange(base, end, milestone) {
  // both ends must be real commits and the reviewed range must be part of HEAD's history
  for (const sha of [base, end]) {
    if (git(['cat-file', '-e', `${sha}^{commit}`]).status !== 0) return `range sha ${sha} is not a commit`;
  }
  if (git(['merge-base', '--is-ancestor', end, 'HEAD']).status !== 0) return `range end ${end} is not an ancestor of HEAD`;
  const first = git(['rev-list', '--reverse', `--grep=^${milestone}\\.`, 'HEAD'])
    .stdout.split(/\r?\n/)
    .find(Boolean);
  if (!first) return `no ${milestone} commits in history`;
  // base must precede the first milestone commit (so base..end starts at the milestone start) and
  // the first milestone commit must be inside base..end — an empty or partial range fails
  if (git(['merge-base', '--is-ancestor', first, base]).status === 0)
    return `range base ${base} is not before the first ${milestone} commit ${first.slice(0, 8)}`;
  if (git(['merge-base', '--is-ancestor', first, end]).status !== 0)
    return `range ${base}..${end} does not include the first ${milestone} commit ${first.slice(0, 8)}`;
  return onlyBookkeepingAfter(end, milestone);
}

/** Every milestone commit after `end` may touch only bookkeeping paths. */
function onlyBookkeepingAfter(end, milestone) {
  const list = git(['rev-list', '--reverse', `${end}..HEAD`, `--grep=^${milestone}\\.`]);
  if (list.status !== 0) return `git rev-list failed: ${list.stderr.trim()}`;
  for (const sha of list.stdout.split(/\r?\n/).filter(Boolean)) {
    const paths = git(['show', '--name-only', '--format=', sha]).stdout.split(/\r?\n/).filter(Boolean);
    const code = paths.find((p) => !BOOKKEEPING_PATHS.some((re) => re.test(p)));
    if (code) return `commit ${sha.slice(0, 8)} after the reviewed range changes ${code}`;
  }
  return true;
}

/**
 * Every row of the milestone's backlog is `done`, and every `reopen` disposition in the given
 * reviews targets an existing row of the backlog that is `done` (M0 cp2 F1).
 */
export function checkBacklogDone(backlogText, milestone, reviews = []) {
  const rows = backlogText
    .split(/\r?\n/)
    .filter((l) => new RegExp(`^\\| ${milestone}\\.\\d+ \\|`).test(l))
    .map((l) => l.split('|').map((c) => c.trim()));
  if (rows.length === 0) return `no ${milestone} rows in the backlog`;
  const ids = rows.map((c) => c[1]);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) return `duplicate backlog rows: ${[...new Set(dupes)].join(', ')}`;
  const state = new Map(rows.map((c) => [c[1], c[6]]));
  // `descoped (<reason>)` closes a row only by explicit human decision whose reason cites an ADR
  // (ADR-NNNN) or the roadmap Deferred table (M0 final F1); a bare or uncited "descoped" does not
  // count. Reopened rows (below) must still be `done`.
  const closed = (s) => s === 'done' || (/^descoped \(\S.*\)$/.test(s) && /\bADR-\d{4}\b|\bDeferred\b/.test(s));
  const notDone = [...state].filter(([, s]) => !closed(s)).map(([id, s]) => `${id} (${s})`);
  if (notDone.length) return `not done: ${notDone.join(', ')}`;
  const reopens = reviews.flatMap((r) => (r?.dispositions ?? []).filter((d) => d.disposition === 'reopen').map((d) => [r, d]));
  for (const [r, d] of reopens) {
    const problem = reopenProblem(d, milestone, state);
    if (problem) return `${r.checkpoint ?? 'review'} ${d.finding}: ${problem}`;
  }
  return true;
}

/** A reopen disposition must name rows of this milestone, and each must be `done`. */
function reopenProblem(d, milestone, state) {
  const ids = String(d.target ?? '').match(new RegExp(`${milestone}\\.\\d+`, 'g')) ?? [];
  if (ids.length === 0) return `reopen target names no ${milestone} row`;
  const missing = ids.filter((id) => state.get(id) !== 'done');
  return missing.length ? `reopened ${missing.join(', ')} missing or not done` : null;
}

/** Every recorded milestone review for `milestone` (any checkpoint name), parsed. */
export function loadMilestoneReviews(milestone) {
  const dir = repoPath('.harness', 'reviews');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith(`milestone-${milestone}-`) && f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
}

/** The backlog text holding `milestone`'s rows: its archive once archived, else current.md. */
export function backlogTextFor(milestone) {
  const has = (p) => existsSync(repoPath(p)) && new RegExp(`^\\| ${milestone}\\.\\d+ \\|`, 'm').test(readFileSync(repoPath(p), 'utf8'));
  for (const p of [`docs/backlog/archive/${milestone}.md`, 'docs/backlog/current.md']) {
    if (has(p)) return readFileSync(repoPath(p), 'utf8');
  }
  return '';
}

/**
 * `pnpm verify` output must contain a PASS line for every required step (M1 cp1 F1): a step that
 * was never registered prints nothing, so "no SKIP lines" alone cannot prove it ran.
 */
export function checkVerifyOutput(stdout, required) {
  const lines = stdout.split(/\r?\n/);
  // exact step name: `size` must not match `size-limit` (\b would, since '-' is a word boundary)
  const status = (step) => lines.find((l) => l.startsWith(`PASS ${step} `) || l.startsWith(`FAIL ${step} `) || l.startsWith(`SKIP ${step} `))?.split(' ')[0];
  const bad = required.map((s) => [s, status(s)]).filter(([, st]) => st !== 'PASS');
  return bad.length === 0 || `not PASS: ${bad.map(([s, st]) => `${s}=${st ?? 'absent'}`).join(', ')}`;
}

/** Every listed workspace has dist/index.js and dist/index.d.ts (build really ran). */
export function checkDistArtifacts(dirs, has = (p) => existsSync(repoPath(p))) {
  const missing = dirs.flatMap((d) => ['dist/index.js', 'dist/index.d.ts'].map((f) => `${d}/${f}`)).filter((p) => !has(p));
  return missing.length === 0 || `missing ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ` (+${missing.length - 4})` : ''}`;
}

/** Tracked git hooks must be executable (POSIX git skips them otherwise). */
export function checkHooksExecutable(hooks = ['pre-commit', 'commit-msg']) {
  const modes = git(['ls-files', '-s', ...hooks.map((h) => `.githooks/${h}`)]).stdout;
  const bad = hooks.filter((h) => !new RegExp(`^100755 \\S+ 0\\t\\.githooks/${h}$`, 'm').test(modes));
  return bad.length === 0 || `not tracked as 100755: ${bad.join(', ')}`;
}
