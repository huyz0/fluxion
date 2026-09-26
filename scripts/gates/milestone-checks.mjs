// Behavioural checks shared by milestone completion gates (M0 cp1 F1: a leg that only checks a
// file exists can be satisfied by a stub). Each returns true | '<reason>' for lib.mjs leg().
import { git } from './lib.mjs';

/** Paths a commit may touch after the final review range without invalidating the review. */
export const BOOKKEEPING_PATHS = [/^\.harness\//, /^docs\/backlog\//, /^docs\/milestones\/(roadmap|M\d+)\.md$/];

/**
 * A dry-runs record must have, per tool, a Success and an Impossible section, each with a
 * non-empty `Date:` and `Outcome:` line — a sentence mentioning the words is not enough.
 */
export function checkDryRuns(text, tools = ['Claude Code', 'Codex']) {
  const missing = [];
  for (const tool of tools) {
    const section = new RegExp(`^## ${tool}\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm').exec(text)?.[1];
    if (!section) { missing.push(`## ${tool}`); continue; }
    for (const kind of ['Success', 'Impossible']) {
      const sub = new RegExp(`^### ${kind}\\s*$([\\s\\S]*?)(?=^##|(?![\\s\\S]))`, 'm').exec(section)?.[1];
      if (!sub) { missing.push(`${tool} / ### ${kind}`); continue; }
      for (const field of ['Date', 'Outcome']) {
        if (!new RegExp(`^${field}:[ \\t]*\\S`, 'm').test(sub)) missing.push(`${tool} / ${kind} / ${field}:`);
      }
    }
  }
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
  if (runs.some((r) => !r.seededDefect || !/^[0-9a-f]{64}$/.test(r.diff_sha256 ?? '') || typeof r.caught !== 'boolean')) bad.push('each run needs seededDefect, diff_sha256, caught');
  if (new Set(runs.map((r) => r.diff_sha256)).size !== runs.length) bad.push('each run needs its own diff_sha256');
  if (!runs.some((r) => r.caught === true)) bad.push('no direction caught the seeded defect');
  // digest columns: task, hash, round, verdict, reviewer, findings
  const lines = digest.split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'));
  const unrecorded = runs.filter((r) =>
    !lines.some(([t, h, , , reviewer = '']) => t === task && h === r.diff_sha256 && reviewer.split(/[-:@/ ]/)[0] === r.reviewer));
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
export function checkFinalReview(review, milestone) {
  if (!review || review.milestone !== milestone) return `review is not for ${milestone}`;
  if (typeof review.reviewer !== 'string' || !review.reviewer.trim()) return 'review has no reviewer';
  if (!Array.isArray(review.findings)) return 'findings must be an array';
  const dispositions = Array.isArray(review.dispositions) ? review.dispositions : [];
  const malformed = dispositions.filter((d) => !d.finding || !DISPOSITIONS.includes(d.disposition));
  if (malformed.length) return `disposition needs finding and one of ${DISPOSITIONS.join('/')}`;
  const disposed = new Set(dispositions.map((d) => d.finding));
  const open = review.findings.filter((f) => ['blocking', 'major'].includes(f.severity) && !disposed.has(f.id));
  if (open.length) return `undispositioned ${open.map((f) => f.id).join(', ')}`;
  const m = /^([0-9a-f]{7,40})\.\.([0-9a-f]{7,40})$/.exec(review.range ?? '');
  if (!m) return 'range must be <base>..<sha>';
  const [, base, end] = m;
  // both ends must be real commits and the reviewed range must be part of HEAD's history
  for (const sha of [base, end]) {
    if (git(['cat-file', '-e', `${sha}^{commit}`]).status !== 0) return `range sha ${sha} is not a commit`;
  }
  if (git(['merge-base', '--is-ancestor', end, 'HEAD']).status !== 0) return `range end ${end} is not an ancestor of HEAD`;
  const first = git(['rev-list', '--reverse', `--grep=^${milestone}\\.`, 'HEAD']).stdout.split(/\r?\n/).find(Boolean);
  if (!first) return `no ${milestone} commits in history`;
  // base must precede the first milestone commit (so base..end starts at the milestone start) and
  // the first milestone commit must be inside base..end — an empty or partial range fails
  if (git(['merge-base', '--is-ancestor', first, base]).status === 0) return `range base ${base} is not before the first ${milestone} commit ${first.slice(0, 8)}`;
  if (git(['merge-base', '--is-ancestor', first, end]).status !== 0) return `range ${base}..${end} does not include the first ${milestone} commit ${first.slice(0, 8)}`;
  const list = git(['rev-list', '--reverse', `${end}..HEAD`, `--grep=^${milestone}\\.`]);
  if (list.status !== 0) return `git rev-list failed: ${list.stderr.trim()}`;
  const after = list.stdout.split(/\r?\n/).filter(Boolean);
  for (const sha of after) {
    const paths = git(['show', '--name-only', '--format=', sha]).stdout.split(/\r?\n/).filter(Boolean);
    const code = paths.filter((p) => !BOOKKEEPING_PATHS.some((re) => re.test(p)));
    if (code.length) return `commit ${sha.slice(0, 8)} after the reviewed range changes ${code[0]}`;
  }
  return true;
}

/** Tracked git hooks must be executable (POSIX git skips them otherwise). */
export function checkHooksExecutable(hooks = ['pre-commit', 'commit-msg']) {
  const modes = git(['ls-files', '-s', ...hooks.map((h) => `.githooks/${h}`)]).stdout;
  const bad = hooks.filter((h) => !new RegExp(`^100755 \\S+ 0\\t\\.githooks/${h}$`, 'm').test(modes));
  return bad.length === 0 || `not tracked as 100755: ${bad.join(', ')}`;
}
