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
  return vitestTitles([title], paths, { env, min, project })[0];
}

/**
 * Run one Vitest project once on `paths` for every title in `titles` (`-t` with the literal titles
 * joined as alternatives), then judge each title as {@link vitestNamed} does: true | '<reason>' per
 * title, in order. `runner(args, env)` is injectable for tests (M4 cp1 F3).
 */
export function vitestTitles(titles, paths, { env = {}, min = 1, project = 'node', runner = runVitest } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'gate-vitest-'));
  try {
    const out = join(dir, 'report.json');
    // -t takes a regular expression; each title is literal (M2 cp1 F1)
    const pattern = titles.map((title) => title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const r = runner(['run', '--project', project, '--reporter=json', `--outputFile=${out}`, '-t', pattern, ...paths], env);
    if (!existsSync(out)) return titles.map(() => `vitest wrote no report: ${r.status === 0 ? 'exit 0' : tail(r)}`);
    const tests = JSON.parse(readFileSync(out, 'utf8')).testResults.flatMap((f) => f.assertionResults);
    return titles.map((title) => {
      const named = tests.filter((x) => x.fullName.includes(title));
      const failed = named.filter((x) => x.status === 'failed');
      const passed = named.filter((x) => x.status === 'passed');
      // a failed run fails every title in it: another title's failure is not this one's pass
      if (r.status !== 0 || failed.length) return `"${title}": ${failed.length} failed (${r.status === 0 ? 'exit 0' : tail(r)})`;
      return passed.length >= min || `"${title}": ${passed.length} passing test(s), need ${min}`;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const runVitest = (args, env) => run('pnpm', ['exec', 'vitest', ...args], { env: { ...process.env, ...env } });

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
export function titled(list, { runner } = {}) {
  // one Vitest run per project and environment, over every package the titles name (M4 cp1 F3)
  const groups = new Map();
  for (const [row, title, pkg, env = {}, project = 'node'] of list) {
    const key = `${project} ${JSON.stringify(env)}`;
    const g = groups.get(key) ?? { project, env, entries: [] };
    g.entries.push({ row, title, pkg });
    groups.set(key, g);
  }
  const bad = [];
  for (const { project, env, entries } of groups.values()) {
    // a package name (`core`) or a workspace path (`packs/basic`)
    const paths = [...new Set(entries.map((e) => (e.pkg.includes('/') ? e.pkg : `packages/${e.pkg}`)))];
    const verdicts = vitestTitles(
      entries.map((e) => e.title),
      paths,
      { env, project, ...(runner ? { runner } : {}) },
    );
    entries.forEach((e, i) => {
      if (verdicts[i] !== true) bad.push(`${e.row} ${verdicts[i]}`);
    });
  }
  return bad.length === 0 || bad.join('; ');
}

// ── NFR-PERF-006: the undo budget, measured by every completion gate from M4 on (M3 final F1) ────
/** The built-in record commands (M3.17) whose undo, redo and transact are benchmarked. */
export const BENCH_COMMANDS = [
  'element.create',
  'element.createMany',
  'element.update',
  'element.updateMany',
  'element.delete',
  'screen.create',
  'screen.delete',
  'screen.reorder',
  'binding.set',
  'connector.freeEnd',
  'element.group',
  'element.ungroup',
  'element.align',
  'document.update',
  'asset.create',
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

// ── one named benchmark under a budget (M6.10: the hit-test-2000 bench) ─────────────────────────────
/**
 * Judge a Vitest 5 JSON bench report for one benchmark: every test passed, exactly one task is named
 * `name`, and its p99 is within `maxMs`.
 */
export function checkBenchTask(report, name, maxMs) {
  const tests = report.testResults.flatMap((f) => f.assertionResults);
  const failed = tests.filter((a) => a.status !== 'passed');
  if (failed.length) return `bench tests failed: ${failed.map((a) => a.title).join(', ')}`;
  const tasks = tests.flatMap((a) => (a.benchmarks ?? []).flatMap((b) => b.tasks)).filter((t) => t.name === name);
  if (tasks.length !== 1) return `${tasks.length} benchmarks named ${name} (want 1)`;
  const p99 = tasks[0].latency?.p99;
  return p99 <= maxMs || `${name} p99 ${Number(p99).toFixed(3)} ms > ${maxMs} ms`;
}

/**
 * Completion-gate leg: run the bench file `file` (Vitest 5, the node bench project) and judge its
 * benchmark `name` with {@link checkBenchTask}. A missing file fails without running anything.
 * `runner(file, out)` and `root` are injectable for tests.
 */
export function benchUnder(file, name, maxMs, { runner = runBenchFile, root = repoPath() } = {}) {
  if (!existsSync(join(root, file))) return `missing ${file}`;
  const dir = mkdtempSync(join(tmpdir(), 'gate-bench-'));
  try {
    const out = join(dir, 'bench.json');
    const r = runner(file, out);
    if (!existsSync(out)) return `no bench output: ${tail(r)}`;
    const judged = checkBenchTask(JSON.parse(readFileSync(out, 'utf8')), name, maxMs);
    return r.status !== 0 && judged === true ? `bench run exited ${r.status}: ${tail(r)}` : judged;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Run one bench file with Vitest 5, JSON to `out`. */
function runBenchFile(file, out) {
  return run('pnpm', ['exec', 'vitest', 'bench', '--run', '--project', 'node (bench)', '--reporter=json', `--outputFile=${out}`, file]);
}

// ── R0 demo content (M4 cp1 F8): a rendered demo screen shows shapes, connectors and token styles ───
/** The HTML of each `.fx-screen` in `html`, from its opening tag to the next screen's (or the end). */
function screensOf(html) {
  const starts = [...html.matchAll(/<[a-z]+\b[^>]*\bclass="[^"]*\bfx-screen\b[^"]*"/g)].map((m) => m.index);
  return starts.map((start, i) => html.slice(start, starts[i + 1] ?? html.length));
}

/**
 * Whether a rendered demo shows what R0 promises: at least `minScreens` `.fx-screen`s, and in each a
 * shape (`.fx-el` with `data-kind="shape"`), a connector drawn as an SVG path or line (`.fx-el` with
 * `data-kind="connector"`), and a token style (`var(--fx-…)`). This is the render rows' markup
 * contract (M4.13-M4.15): element wrappers carry `data-kind`.
 */
export function checkDemoHtml(html, minScreens = 2) {
  const screens = screensOf(html);
  if (screens.length < minScreens) return `${screens.length} .fx-screen (want ${minScreens})`;
  const problems = screens.flatMap((screen, i) => {
    const missing = screenLacks(screen);
    return missing.length ? [`screen ${i + 1} lacks ${missing.join(', ')}`] : [];
  });
  return problems.length === 0 || problems.join('; ');
}

/** What one rendered screen lacks of a shape, a connector path and a token style. */
function screenLacks(screen) {
  const shape = /class="[^"]*\bfx-el\b[^"]*"[^>]*\bdata-kind="shape"|data-kind="shape"[^>]*class="[^"]*\bfx-el\b/.test(screen);
  // a connector wrapper, up to the next element wrapper, holds an SVG path or line
  const at = screen.search(/<[a-z]+\b[^>]*data-kind="connector"/);
  const rest = at < 0 ? '' : screen.slice(at + 1);
  const next = rest.search(/<[a-z]+\b[^>]*\bdata-kind="/);
  const connector = at >= 0 && /<(path|line)\b/.test(next < 0 ? rest : rest.slice(0, next));
  const token = /var\(--fx-/.test(screen);
  return [
    [shape, 'a shape'],
    [connector, 'a connector path'],
    [token, 'a token style'],
  ]
    .filter(([has]) => !has)
    .map(([, what]) => what);
}

/**
 * The published workspaces whose shipped files (`src/`, `package.json`) `changed` touches and that no
 * changeset text names (M4 final F1): pure, over repo-relative paths, the changeset file contents
 * and the workspaces as `{ dir, name, private }`.
 */
export function changesetGaps(changed, changesetTexts, workspaces) {
  // only the release lines of each changeset's frontmatter count, not a name in its prose (review F2)
  const released = new Set(
    changesetTexts.flatMap((t) => {
      const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(t)?.[1] ?? '';
      return [...front.matchAll(/^\s*['"]([^'"]+)['"]\s*:/gm)].map((m) => m[1]);
    }),
  );
  const named = (name) => released.has(name);
  const touched = (dir) => changed.some((p) => p.startsWith(`${dir}/src/`) || p === `${dir}/package.json`);
  return workspaces.filter((w) => !w.private && touched(w.dir) && !named(w.name)).map((w) => w.name);
}

/**
 * Every published workspace the range `base..HEAD` changed has a changeset naming it (M4 final F1).
 * Only changesets the range added or changed count, read as committed at HEAD: an older, not yet
 * released changeset covers the milestone that wrote it, not this one (M5.3 review F1).
 */
export function changesetsCoverRange(base) {
  // --no-renames: a file moved between workspaces changes both of them (review r2 F1)
  const diff = git(['diff', '--name-only', '--no-renames', base, 'HEAD']);
  if (diff.status !== 0) return `git diff ${base}..HEAD failed: ${diff.stderr.trim()}`;
  const sets = git(['diff', '--name-only', '--no-renames', '--diff-filter=AM', base, 'HEAD', '--', '.changeset']);
  const texts = sets.stdout
    .split(/\r?\n/)
    .filter((f) => f.endsWith('.md') && !f.endsWith('/README.md'))
    .map((f) => git(['show', `HEAD:${f}`]).stdout);
  const workspaces = JSON.parse(readFileSync(repoPath('tools/gen/workspaces.json'), 'utf8')).workspaces.map((w) => {
    const pkg = join(repoPath(w.dir), 'package.json');
    return { dir: w.dir, name: w.name, private: existsSync(pkg) && JSON.parse(readFileSync(pkg, 'utf8')).private === true };
  });
  const gaps = changesetGaps(diff.stdout.split(/\r?\n/).filter(Boolean), texts, workspaces);
  return gaps.length === 0 || `no changeset for ${gaps.join(', ')} (changed since ${base.slice(0, 8)})`;
}

/**
 * What a README lacks to describe its package: `true`, or the problem (M5 cp1 F4: a heading alone
 * is not a description). `required` are words or ids the text must name; a leftover M1 stub fails.
 */
export function readmeGaps(text, required, { minLines = 8 } = {}) {
  if (/stub \(M1\)/.test(text)) return 'still the M1 stub';
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '').length;
  if (lines < minLines) return `${lines} non-empty lines (< ${minLines})`;
  const missing = required.filter((w) => !text.includes(w));
  return missing.length === 0 || `does not name ${missing.join(', ')}`;
}

/** An `it`/`test`/`describe` call, with any modifier (`.skip`, `.each(…)`). */
// a test or suite call, not a method of that name (`re.test(s)`: M5.32 review F2)
const CASE_CALL = /(?<![.\w])(?:it|test|describe)(?:\.\w+)*\(/g;

/**
 * The number of runs the fast-check property titled `title` asks for in `source`: the `numRuns` in
 * the body of the `it`/`test` call with that title, up to the next test or suite call (M5.32 review
 * F2): a number, or a constant the file declares as one (M5.32 review F1); 0 when it names none (the
 * runner's default applies: 200, tools/vitest/fast-check.setup.ts) or no such call exists; NaN when
 * it is computed some other way and cannot be read.
 */
export function propertyRuns(source, title) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const call = new RegExp(`\\b(?:it|test)(?:\\.\\w+)*\\(\\s*(['"\`])${escaped}\\1`).exec(source);
  if (call === null) return 0;
  const from = call.index + call[0].length;
  CASE_CALL.lastIndex = from;
  const next = CASE_CALL.exec(source);
  // the whole value up to the next `,` or `}`: an expression such as `5000 - 4999` is not its first operand (M5.23 review F1)
  const runs = /numRuns:\s*([^,}]+?)\s*[,}]/.exec(source.slice(from, next === null ? undefined : next.index))?.[1];
  if (runs === undefined) return 0;
  // a named constant: its declared value
  const value = /^[A-Za-z_$][\w$]*$/.test(runs) ? new RegExp(`\\b(?:const|let)\\s+${runs}\\s*=\\s*([\\d_]+)\\s*;`).exec(source)?.[1] : runs;
  return value !== undefined && /^[\d_]+$/.test(value) ? Number(value.replace(/_/g, '')) : Number.NaN;
}

/**
 * Whether the coverage `summary` (Vitest json-summary) of `dir`'s sources meets `floors`: `true`, or
 * what falls short. Fewer than `min` statements is a failure too: an empty package proves nothing.
 */
export function coverageGaps(summary, dir, { lines, branches }, min) {
  const files = Object.entries(summary).filter(([f]) => f.replace(/\\/g, '/').includes(`/${dir}/src/`));
  const sum = (k, f) => files.reduce((a, [, v]) => a + v[k][f], 0);
  // nothing to cover is fully covered: a data-only pack has statements but no branches (M5.38);
  // an empty package still fails, on its statement count
  const pct = (k) => (sum(k, 'total') === 0 ? 100 : (100 * sum(k, 'covered')) / sum(k, 'total'));
  const bad = [];
  if (sum('statements', 'total') < min) bad.push(`${sum('statements', 'total')} statements (< ${min})`);
  if (pct('lines') < lines) bad.push(`lines ${pct('lines').toFixed(1)}%`);
  if (pct('branches') < branches) bad.push(`branches ${pct('branches').toFixed(1)}%`);
  return bad.length === 0 || `${dir}: ${bad.join('; ')}`;
}

/** The tests of a Playwright JSON report, flattened: spec file (repo-relative), project and status. */
function playwrightTests(report) {
  const out = [];
  const walk = (suite, file) => {
    const here = suite.file ?? file;
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) out.push({ file: String(here ?? '').replace(/\\/g, '/'), project: t.projectName, status: t.status, title: spec.title });
    }
    for (const child of suite.suites ?? []) walk(child, here);
  };
  for (const s of report?.suites ?? []) walk(s, s.file);
  return out;
}

/**
 * Judge a Playwright JSON report: every spec of `specs` (paths under e2e/) ran at least one test on
 * every project of `projects`, and every one of them passed on its first run (a pass on retry is
 * flaky, and flaky is not green; M6.1). true | '<reason>'.
 */
export function checkPlaywrightReport(report, specs, projects) {
  const tests = playwrightTests(report);
  const bad = [];
  for (const spec of specs) {
    const name = spec.replace(/^e2e\//, '');
    for (const project of projects) {
      const mine = tests.filter((t) => (t.file === name || t.file.endsWith(`/${name}`)) && t.project === project);
      if (mine.length === 0) bad.push(`${spec} [${project}]: no test ran`);
      for (const t of mine.filter((x) => x.status !== 'expected')) bad.push(`${spec} [${project}] "${t.title}": ${t.status}`);
    }
  }
  return bad.length === 0 || bad.slice(0, 6).join('; ') + (bad.length > 6 ? `; … ${bad.length - 6} more` : '');
}

/**
 * Judge a Playwright JSON report for named tests: each title of `titles` names a test of `spec` that
 * ran and passed on its first run on every project of `projects` (a leg pinning what a spec proves,
 * not only that it passes; M6 cp1 F4). true | '<reason>'.
 */
export function checkPlaywrightTitles(report, spec, titles, projects) {
  const name = spec.replace(/^e2e\//, '');
  const tests = playwrightTests(report).filter((t) => t.file === name || t.file.endsWith(`/${name}`));
  const bad = [];
  for (const title of titles) {
    for (const project of projects) {
      const run = tests.filter((t) => t.title === title && t.project === project);
      if (run.length === 0) bad.push(`${spec} [${project}]: no test titled "${title}"`);
      else if (run.some((t) => t.status !== 'expected')) bad.push(`${spec} [${project}] "${title}": ${run.map((t) => t.status).join(', ')}`);
    }
  }
  return bad.length === 0 || bad.slice(0, 6).join('; ') + (bad.length > 6 ? `; … ${bad.length - 6} more` : '');
}

const runPlaywright = (args, env) => run('pnpm', ['exec', 'playwright', 'test', ...args], { env: { ...process.env, ...env } });

/** Whether Docker answers on this host. */
export const dockerAvailable = () => run('docker', ['version', '--format', '{{.Server.Version}}']).status === 0;

/**
 * Run the Playwright specs `specs` on `projects` once and return the JSON report, or a reason when the
 * run wrote none. `runner(args, env)` is injectable (tests; the pinned image).
 */
export function playwrightReport(specs, projects, { runner = runPlaywright, workers } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'gate-playwright-'));
  try {
    const out = join(dir, 'report.json');
    // a measuring run (a benchmark) takes one worker, alone on the machine (M6.4 review r2 F1)
    const alone = workers === undefined ? [] : [`--workers=${workers}`];
    const r = runner([...specs, ...projects.map((p) => `--project=${p}`), ...alone, '--reporter=json'], { PLAYWRIGHT_JSON_OUTPUT_NAME: out });
    if (!existsSync(out)) return `playwright wrote no report: ${r.status === 0 ? 'exit 0' : tail(r)}`;
    return JSON.parse(readFileSync(out, 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Run the Playwright specs `specs` on `projects` (the built studio, playwright.config.ts) and judge
 * them with {@link checkPlaywrightReport}. A missing spec fails without running anything.
 * `runner(args, env)` is injectable for tests.
 */
export function playwrightSpecs(specs, projects, { runner = runPlaywright } = {}) {
  const missing = specs.filter((s) => !exists(s));
  if (missing.length) return `missing ${missing.join(', ')}`;
  const report = playwrightReport(specs, projects, { runner });
  return typeof report === 'string' ? report : checkPlaywrightReport(report, specs, projects);
}
