// Behavioural checks shared by milestone completion gates (M0 cp1 F1: a leg that only checks a
// file exists can be satisfied by a stub). Each returns true | '<reason>' for lib.mjs leg().
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { exists, git, repoPath, run } from './lib.mjs';

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
 * Titles of passing leaf tests in node:test spec-reporter output. Suites print `▶ name` before
 * their children and `✔ name (…ms)` after them, so a ✔ line whose title opened a suite is not a test.
 */
export function passingTestTitles(spec) {
  const lines = spec.split(/\r?\n/);
  const suites = new Set(lines.map((l) => /^\s*▶ (.*)$/.exec(l)?.[1]).filter(Boolean));
  // the line must end at the duration: todo/skipped cases print `✔ name (…ms) # TODO` (M1.10 review F1)
  return lines.map((l) => /^\s*✔ (.*) \([\d.]+m?s\)$/.exec(l)?.[1]).filter((t) => t !== undefined && !suites.has(t));
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

/** The one tolerated SKIP line of the full ladder: the workflow linters need a Docker engine. */
const TOLERATED_SKIP = /^SKIP workflows — Docker not available$/;

/**
 * Completion-gate leg "pnpm verify exits 0 with every planned step PASS", shared by every gate from
 * m3-complete on (M2.29 review F1/F2). The ladder runs with CI unset: under CI=true the budget step
 * accepts a record older than the lockfile (ADR-0143), and a completion gate must judge the recorded
 * budget. `command` is injectable for tests; it defaults to `pnpm verify` in the repo.
 */
export function verifyLeg(required, { command = ['pnpm', ['verify']], cwd } = {}) {
  const env = { ...process.env, CI: '' };
  const r = run(command[0], command[1], { env, ...(cwd ? { cwd } : {}) });
  if (r.status !== 0) return `${(r.stderr || r.stdout).trim().split(/\r?\n/).slice(-3).join(' | ')}`;
  const skips = r.stdout.split(/\r?\n/).filter((l) => l.startsWith('SKIP') && !TOLERATED_SKIP.test(l.trim()));
  if (skips.length) return `skipped: ${skips.join(' | ')}`;
  return checkVerifyOutput(r.stdout, required);
}

const tail = (r) => (r.stderr || r.stdout).trim().split(/\r?\n/).slice(-3).join(' | ');

/**
 * Run one Vitest project (`node` or `browser`) on `paths` filtered by `-t title`; at least `min`
 * tests whose full name contains the title must pass and none may fail. A comment or a skipped test
 * cannot satisfy it (shared from m4-complete on; written for m3).
 */
export function vitestNamed(title, paths, { env = {}, min = 1, project = 'node' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'gate-vitest-'));
  try {
    const out = join(dir, 'report.json');
    // -t takes a regular expression; the title is literal (M2 cp1 F1)
    const literal = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const r = run('pnpm', ['exec', 'vitest', 'run', '--project', project, '--reporter=json', `--outputFile=${out}`, '-t', literal, ...paths], {
      env: { ...process.env, ...env },
    });
    if (!existsSync(out)) return `vitest wrote no report: ${r.status === 0 ? 'exit 0' : tail(r)}`;
    const tests = JSON.parse(readFileSync(out, 'utf8')).testResults.flatMap((f) => f.assertionResults);
    const named = tests.filter((x) => x.fullName.includes(title));
    const failed = named.filter((x) => x.status === 'failed');
    const passed = named.filter((x) => x.status === 'passed');
    if (r.status !== 0 || failed.length) return `"${title}": ${failed.length} failed (${r.status === 0 ? 'exit 0' : tail(r)})`;
    return passed.length >= min || `"${title}": ${passed.length} passing test(s), need ${min}`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Run named node:test cases of one harness file; each pattern needs a passing case titled with it. */
export function namedCases(file, patterns) {
  if (!exists(file)) return `missing ${file}`;
  for (const p of patterns) {
    const r = run(process.execPath, ['--test-reporter=spec', `--test-name-pattern=${p}`, file]);
    const titles = passingTestTitles(r.stdout).filter((x) => x.includes(p));
    if (r.status !== 0 || titles.length < 1) return `${file}: no passing test titled with "${p}"`;
  }
  return true;
}

/** Every [row, title, package, env?, project?] passes under its exact title. */
export function titled(list) {
  const bad = list.map(([row, title, pkg, env, project]) => [row, vitestNamed(title, [`packages/${pkg}`], { env, project })]).filter(([, r]) => r !== true);
  return bad.length === 0 || bad.map(([row, r]) => `${row} ${r}`).join('; ');
}

// ── NFR-PERF-006: the undo budget, measured by every completion gate from M4 on (M3 final F1) ────
/** The built-in record commands (M3.17) whose undo, redo and transact are benchmarked. */
export const BENCH_COMMANDS = [
  'element.create',
  'element.update',
  'element.delete',
  'screen.create',
  'screen.delete',
  'screen.reorder',
  'binding.set',
  'document.update',
];
/** undo/redo and the forward transactions on 5 000 records, stores with default options (validation on). */
export const BENCH_FILES = ['packages/core/bench/undo-5000.bench.ts', 'packages/core/bench/transact-5000.bench.ts'];
const BENCH_DIR = 'packages/core/bench';

/**
 * Judge a Vitest 5 JSON bench report (benches run inside tests; each test lists its results under
 * `benchmarks`): every test passed, a benchmark named `<undo|redo|transact> <command id>` exists for
 * every built-in command, and each p99 is within `maxMs`.
 */
export function checkBenchReport(report, maxMs, commands = BENCH_COMMANDS) {
  const tests = report.testResults.flatMap((f) => f.assertionResults);
  const failed = tests.filter((a) => a.status !== 'passed');
  if (failed.length) return `bench tests failed: ${failed.map((a) => a.title).join(', ')}`;
  const benches = tests.flatMap((a) => (a.benchmarks ?? []).flatMap((b) => b.tasks)).map((b) => ({ name: b.name, p99: b.latency?.p99 }));
  // names are exactly "<undo|redo|transact> <command id>", one per built-in command (M3.1 review F1)
  const want = commands.flatMap((c) => [`undo ${c}`, `redo ${c}`, `transact ${c}`]);
  const missing = want.filter((w) => !benches.some((b) => b.name === w));
  if (missing.length) return `no benchmark named: ${missing.join(', ')}`;
  const slow = benches.filter((b) => want.includes(b.name) && !(b.p99 <= maxMs));
  return slow.length === 0 || slow.map((b) => `${b.name} p99 ${Number(b.p99).toFixed(2)} ms`).join('; ');
}

/** Run the benches with Vitest 5 (`vitest bench` adds a "<project> (bench)" variant), JSON to `out`. */
function runBenches(out) {
  return run('pnpm', ['exec', 'vitest', 'bench', '--run', '--project', 'node (bench)', '--reporter=json', `--outputFile=${out}`, ...BENCH_FILES]);
}

/**
 * Completion-gate leg for NFR-PERF-006: the bench files exist, no file of the bench folder (helpers
 * included) switches validation off (cp1 F3, M3.26 review F1), and the report passes
 * {@link checkBenchReport} at `maxMs`. `runner(out)` and `root` are injectable for tests.
 */
export function benchLeg(maxMs, { runner = runBenches, root = repoPath() } = {}) {
  const missingFiles = BENCH_FILES.filter((b) => !existsSync(join(root, b)));
  if (missingFiles.length) return `missing ${missingFiles.join(', ')}`;
  const benchDir = join(root, BENCH_DIR);
  // every file under the folder, nested helpers included (M4.7 review F1, M3.26 review F1)
  const files = readdirSync(benchDir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(benchDir, join(e.parentPath, e.name)).split(sep).join('/'));
  const off = files.filter((f) => /\bvalidate\s*:\s*false\b/.test(readFileSync(join(benchDir, f), 'utf8')));
  if (off.length) return `validation switched off in ${off.map((f) => `${BENCH_DIR}/${f}`).join(', ')}`;
  const dir = mkdtempSync(join(tmpdir(), 'gate-bench-'));
  try {
    const out = join(dir, 'bench.json');
    const r = runner(out);
    if (!existsSync(out)) return `no bench output: ${tail(r)}`;
    const judged = checkBenchReport(JSON.parse(readFileSync(out, 'utf8')), maxMs);
    return r.status !== 0 && judged === true ? `bench run exited ${r.status}: ${tail(r)}` : judged;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
