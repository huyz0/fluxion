#!/usr/bin/env node
// Main's CI before a task (M5.2, M4 final F3): the drive and next-task loops run this first. For each
// required workflow (ci, gates) it reads the newest *completed* run on the branch; a run that did not
// succeed blocks the next task (exit 1) until it is fixed, so a platform break cannot sit under a
// stack of later commits. A newer pending run is a fix only when its commit declares it with a
// `Fixes-ci: <run-id>` trailer naming that red run (M18.118, cp12 F2): then it exits 2, wait for that
// run, do not fix again. Any other pending run is ordinary work landing on red and does not hide it;
// nor does a declared fix once more than LAST_CI_MAX_PENDING runs are pending on the same red, or
// once the fix has been pending for LAST_CI_MAX_WAIT_MS. An older red run that a newer green one
// replaced does not block. Each workflow's newest completed run is read by a status-filtered query, so the
// branch window cannot drop it. Exit 3 (unknown, M18.128): more than LAST_CI_MAX_PENDING pending runs with
// none completed (M18.134), a failed status query with none in the window, or no answer from GitHub;
// red (1) outranks unknown, unknown outranks a wait (2). Exit 0: every workflow is green or has no completed run yet. The nightly's latest
// completed run is reported too, never as a verdict: its failures do not block a task (nightly.yml), but its
// state is what the final mutation and nightly rows read (M18.124).
//   node scripts/harness/last-ci.mjs [--branch main] [--runs-file <json>] [--now <iso>] [--offline] [--backlog <file>]
// --runs-file: a JSON array of runs in `gh run list --json databaseId,workflowName,headSha,status,
// conclusion,createdAt` shape, used instead of GitHub (tests; `outsideWindow` marks a run only the
// status-filtered query sees); a run's optional `message` stands in
// for its commit message, which is otherwise read from the local clone, fetching an unseen head from origin
// unless --offline. On red, an open `blocks-landing` row of the backlog (--backlog, default the repo's) is named:
// while it is open, that row and commits confined to HARNESS_PATHS may proceed (M18.142, cp16 F2).
// ci's newest completed run's cold-setup result and blame line are printed: a failure by status exits 1,
// a failure by time is a warning, an unreadable log is said (M18.161, cp19 F2). A success that passed
// only under check-budget's by-time exemption while M18.157 is open (M18.159) is printed as over budget
// with its duration, never green (M18.164). A run's optional `coldSetup: { conclusion, ms, log }`
// stands in for GitHub in --runs-file. A pending run is read before it completes (M18.191, cp24 F1):
// any job concluded failure (or timed_out, startup_failure) is RED at that run, waited for only as a declared fix of it is; jobs that
// cannot be read are unknown; a cancelled or unfinished job is not a failure. More than
// LAST_CI_MAX_PENDING pending runs behind a completed green are unknown, never green. A run's optional
// `jobs: [{ name, conclusion }]` (or 'throws') stands in for GitHub in --runs-file. A green ci run is
// INTERMITTENT (exit 1) while a job failed or timed out in a ci run on its product tree and has not been
// green in two later completed runs there (M18.196, cp25 F2, same-tree.mjs); an unreadable tree or job
// list is unknown. In --runs-file a run's optional `tree` names its product tree (else its head sha).
// The tree's runs are paged back to its start, never read from the branch window; a page that cannot be
// read, or running out first, is unknown (M18.199, cp26 F1). --page-size <n>: runs per page of --runs-file.
// A red run, or an intermittent tree, also waits (exit 2, bounded as above) for a pending run whose commit
// changes a product path and declares Fixes-ci for a ci run on the branch that failed the same job (M18.200,
// cp26 F2); a harness-only commit fixes no product job. In --runs-file a run's `paths` stand for its commit's.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { PAGE_SIZE, runSource, transportHint } from '../gates/ci-runs.mjs';
import { blockingRows } from '../gates/landing-block.mjs';
import { repoPath } from '../gates/lib.mjs';
import { describe, intermittent, pagedTreeRuns, productPath, shaTreeRuns } from '../gates/same-tree.mjs';
import { t } from '../gates/thresholds.mjs';

const WORKFLOWS = ['ci', 'gates'];
/** Exit code when main's CI state cannot be known; drive treats it like red for feature rows (M18.128). */
const UNKNOWN = 3;
const argv = process.argv.slice(2);
const opt = (k) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const branch = opt('branch') ?? 'main';
const now = opt('now') ? Date.parse(opt('now')) : Date.now();

const offline = argv.includes('--offline');
const show = (sha) => spawnSync('git', ['show', '-s', '--format=%B', sha], { encoding: 'utf8' });
/**
 * The commit message of a run's head: its `message` field (REST), else the local clone's copy, fetched
 * from origin when the clone has not seen it yet (M18.118 r1 F1); '' when it cannot be had.
 */
function messageOf(r) {
  if (typeof r.message === 'string') return r.message;
  const sha = String(r.headSha);
  let shown = show(sha);
  if (shown.status !== 0 && !offline && /^[0-9a-f]{40}$/.test(sha)) {
    spawnSync('git', ['fetch', '-q', '--no-tags', 'origin', sha], { encoding: 'utf8', timeout: 60_000 });
    shown = show(sha);
  }
  return shown.status === 0 ? shown.stdout : '';
}
/** The run ids a message's `Fixes-ci:` trailers name. */
const declared = (message) => [...message.matchAll(/^Fixes-ci:\s*(.+)$/gim)].flatMap((m) => m[1].split(/[\s,]+/).filter(Boolean));

/** The paths a run's head changes: its `paths` (--runs-file), else the local clone's; [] when unknown. */
function pathsOf(r) {
  if (Array.isArray(r.paths)) return r.paths;
  ensureCommit(r.headSha);
  const shown = spawnSync('git', ['show', '--format=', '--name-only', '--no-renames', String(r.headSha)], { encoding: 'utf8' });
  return shown.status === 0 ? shown.stdout.split(/\r?\n/).filter(Boolean) : [];
}
/** The jobs that failed in run `id` (ci's aggregate job aside), [] when they cannot be read. */
async function failedJobs(id) {
  const jobs = await Promise.resolve(source.jobs?.(id)).catch(() => null);
  return Array.isArray(jobs) ? jobs.filter((j) => FAILED_JOB.has(j.conclusion) && j.name !== 'ci-ok').map((j) => j.name) : [];
}
/**
 * A pending product fix of the same failed job (M18.200, cp26 F2): the oldest run of `newer` whose commit
 * changes a product path and declares Fixes-ci for a ci run on the branch that failed one of `jobs`, as
 * `{ fix, job, named }`; undefined when none. A harness-only commit fixes no product job.
 */
async function sameJobFix(jobs, newer) {
  if (jobs.length === 0) return undefined;
  for (const r of [...newer].reverse()) {
    const ids = declared(messageOf(r));
    if (ids.length === 0 || !pathsOf(r).some(productPath)) continue;
    for (const named of ids) {
      const job = await namedFailedJob(named, jobs);
      if (job !== undefined) return { fix: r, job, named };
    }
  }
  return undefined;
}
/** The one of `jobs` that failed in ci run `named` on the branch; undefined when none or unreadable. */
async function namedFailedJob(named, jobs) {
  const run = await Promise.resolve(source.view?.(named)).catch(() => null);
  if (run?.workflowName !== 'ci' || run.headBranch !== branch) return undefined;
  // ci's aggregate job fails with any other, so it never ties a fix to a red (M18.200 r1)
  return (run.jobs ?? []).find((j) => FAILED_JOB.has(j.conclusion) && j.name !== 'ci-ok' && jobs.includes(j.name))?.name;
}
/** Exit 2 while `fix`, one of `newer`, is pending within the bounds of M18.118; else 1. */
function boundedWait(head, fix, newer, wait) {
  if (newer.length > t('LAST_CI_MAX_PENDING'))
    return { verdict: 1, line: `${head}: more than ${t('LAST_CI_MAX_PENDING')} runs pending on one red; stop landing and fix main's CI` };
  const waited = now - Date.parse(fix.createdAt);
  if (!(waited <= t('LAST_CI_MAX_WAIT_MS')))
    return {
      verdict: 1,
      line: `${head}: the declared fix (run ${fix.databaseId}) has been pending over ${t('LAST_CI_MAX_WAIT_MS') / 60000} min; check it by hand`,
    };
  return { verdict: 2, line: `${head}: ${wait}, then run last-ci again` };
}
/**
 * How a red run with `newer` pending runs is reported: exit 2 (wait) only for a bounded fix that declares
 * Fixes-ci for it, or a pending product fix of one of its failed `jobs` (M18.200; read when not given).
 */
async function redWithPending(workflow, done, newer, jobs) {
  const sha = String(done.headSha).slice(0, 7);
  const head = `last-ci: RED ${workflow} ${done.conclusion} at ${sha} (run ${done.databaseId}) (${newer.length} newer run${newer.length === 1 ? '' : 's'} pending)`;
  const fix = newer.findLast((r) => declared(messageOf(r)).includes(String(done.databaseId)));
  if (fix !== undefined) return boundedWait(head, fix, newer, `wait for the declared fix (run ${fix.databaseId})`);
  const same = await sameJobFix(jobs ?? (await failedJobs(done.databaseId)), newer);
  if (same === undefined) return { verdict: 1, line: `${head}: none declares Fixes-ci: ${done.databaseId}; fix main's CI before the next task` };
  return boundedWait(head, same.fix, newer, `wait for the pending fix of job ${same.job} (run ${same.fix.databaseId}, Fixes-ci: ${same.named})`);
}

/**
 * Pending runs whose jobs already failed (M18.191, cp24 F1): each is red at that run, waited for only
 * while a newer pending run declares Fixes-ci for it; unreadable jobs are unknown, never green.
 */
/** Job conclusions that already make a pending run red; cancelled, skipped and unfinished ones do not. */
const FAILED_JOB = new Set(['failure', 'timed_out', 'startup_failure']);
async function pendingRed(workflow, newer) {
  let verdict = 0;
  const lines = [];
  for (const [i, r] of newer.entries()) {
    const sha = String(r.headSha).slice(0, 7);
    const jobs = await Promise.resolve(source.jobs?.(r.databaseId)).catch(() => null);
    if (!Array.isArray(jobs)) {
      verdict = worst(verdict, UNKNOWN);
      lines.push(`last-ci: UNKNOWN ${workflow}: the jobs of pending run ${r.databaseId} at ${sha} could not be read; check CI by hand`);
      continue;
    }
    const failedOnes = jobs.filter((j) => FAILED_JOB.has(j.conclusion));
    const failed = failedOnes.map((j) => `${j.name}${j.conclusion === 'failure' ? '' : ` ${j.conclusion}`}`);
    if (failed.length === 0) continue;
    const run = { ...r, conclusion: `failure in ${failed.join(', ')} (run still pending)` };
    const red =
      i === 0
        ? { verdict: 1, line: `last-ci: RED ${workflow} ${run.conclusion} at ${sha} (run ${r.databaseId}): fix main's CI before the next task` }
        : await redWithPending(
            workflow,
            run,
            newer.slice(0, i),
            failedOnes.map((j) => j.name),
          );
    verdict = worst(verdict, red.verdict);
    lines.push(red.line);
  }
  return { verdict, lines };
}

/** Fetch `sha` from origin when the clone has not seen it, unless --offline. */
function ensureCommit(sha) {
  if (spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`]).status === 0 || offline || !/^[0-9a-f]{40}$/.test(String(sha))) return;
  spawnSync('git', ['fetch', '-q', '--no-tags', 'origin', String(sha)], { encoding: 'utf8', timeout: 60_000 });
}
/**
 * The ci runs with `done`'s product tree, paged back to the tree's start (M18.199, cp26 F1). In
 * --runs-file a run's `tree` (else its head) names its tree; a run older than `done` on another tree is
 * the start, and the file is the whole history unless an entry says `truncated`.
 */
function treeRuns(done) {
  if (opt('runs-file')) {
    const key = (r) => r.tree ?? r.headSha;
    return pagedTreeRuns({
      page: (n) => source.ciPage(branch, n),
      on: (r) => key(r) === key(done),
      start: (r) => key(r) !== key(done) && String(r.createdAt) < String(done.createdAt),
      complete: !fileRuns.some((r) => r.truncated),
    });
  }
  const page = async (n) => {
    const runs = await source.ciPage(branch, n);
    for (const r of runs) ensureCommit(r.headSha);
    return runs;
  };
  ensureCommit(done.headSha);
  return shaTreeRuns(page, done.headSha);
}
/** A green ci run is intermittent while a job failed on its tree and is not yet green twice since (M18.196, cp25 F2). */
async function sameTreeVerdict(workflow, done) {
  const where = `green at ${String(done.headSha).slice(0, 7)} (run ${done.databaseId})`;
  let onIt;
  try {
    onIt = await treeRuns(done);
  } catch (e) {
    return {
      verdict: UNKNOWN,
      lines: [`last-ci: UNKNOWN ${workflow}: the runs on the product tree of its ${where} cannot be read (${e.message}); check CI by hand`],
    };
  }
  const withJobs = [];
  for (const r of onIt) {
    const jobs = await Promise.resolve(source.jobs?.(r.databaseId)).catch(() => null);
    if (!Array.isArray(jobs))
      return {
        verdict: UNKNOWN,
        lines: [`last-ci: UNKNOWN ${workflow}: the jobs of run ${r.databaseId} on the tree of its ${where} could not be read; check CI by hand`],
      };
    withJobs.push({ ...r, jobs });
  }
  const found = intermittent(withJobs);
  const lines = describe(found).map((line) => `last-ci: INTERMITTENT ${workflow} ${where}: ${line}`);
  return { verdict: found.length ? 1 : 0, lines, jobs: found.map((f) => f.job) };
}
/** An intermittent tree waits (exit 2) while a newer pending run is a bounded product fix of one of its jobs (M18.200). */
async function intermittentWithPending(tree, newer) {
  const same = newer.length ? await sameJobFix(tree.jobs, newer) : undefined;
  if (same === undefined) return { verdict: 1, lines: tree.lines.map((line) => `${line}; fix it before the next task`) };
  const waited = boundedWait('', same.fix, newer, `wait for the pending fix of job ${same.job} (run ${same.fix.databaseId}, Fixes-ci: ${same.named})`);
  return { verdict: waited.verdict, lines: tree.lines.map((line) => `${line}${waited.line}`) };
}

const newest = (list) => [...list].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
/** The window plus each workflow's newest completed run, once each. */
const withNewestCompleted = (window, completed) => [...window, ...completed.filter((c) => !window.some((r) => r.databaseId === c.databaseId))];

/**
 * --runs-file as a run source, so tests take the same reading path as GitHub: a run marked
 * `outsideWindow` is one only the status-filtered query sees; a `{ workflowName, queryFails: true }`
 * entry makes that workflow's query fail.
 */
function fileSource(all) {
  const pushes = all.filter((r) => r.workflowName !== 'nightly' && !r.queryFails);
  return {
    // ci's runs newest first in pages of --page-size, `outsideWindow` ones too; `{ pageFails: n }` fails page n
    ciPage: async (_, n) => {
      if (all.some((r) => r.pageFails === n)) throw new Error(`page ${n} of the runs file failed`);
      const size = Number(opt('page-size') ?? PAGE_SIZE);
      const ci = pushes.filter((r) => r.workflowName === 'ci').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return ci.slice((n - 1) * size, n * size);
    },
    branch: async () => pushes.filter((r) => !r.outsideWindow),
    completed: async (_, file) => {
      const workflow = file.replace(/\.yml$/, '');
      if (all.some((r) => r.queryFails && r.workflowName === workflow)) throw new Error('query failed');
      return [newest(pushes.filter((r) => r.workflowName === workflow && r.status === 'completed'))].filter(Boolean);
    },
    // a run of the file by id, on the branch unless it says otherwise (M18.200)
    view: async (id) => {
      const r = all.find((x) => String(x.databaseId) === String(id));
      if (r === undefined) throw new Error(`run ${id} not in --runs-file`);
      return { headBranch: branch, ...r, jobs: Array.isArray(r.jobs) ? r.jobs : [] };
    },
    jobs: async (id) => {
      const jobs = all.find((r) => r.databaseId === id)?.jobs ?? [];
      if (jobs === 'throws') throw new Error('query failed');
      return jobs;
    },
    coldSetup: async (id) => {
      const cold = all.find((r) => r.databaseId === id)?.coldSetup;
      if (cold === 'throws') throw new Error('query failed');
      return cold;
    },
    nightly: async () => {
      if (all.some((r) => r.queryFails && r.workflowName === 'nightly')) throw new Error('query failed');
      return all.filter((r) => r.workflowName === 'nightly');
    },
  };
}

let runs;
let nightlyRuns;
let source;
/** The --runs-file entries, [] when GitHub is read. */
let fileRuns = [];
/** Workflows whose status-filtered query failed: no completed run in the window is then unknown, not "none yet" (r1 F2). */
const unread = new Set();
try {
  fileRuns = opt('runs-file') ? JSON.parse(readFileSync(opt('runs-file'), 'utf8')) : [];
  source = opt('runs-file') ? fileSource(fileRuns) : runSource();
  // the branch window mixes workflows and can drop an old red run; ask for each workflow's newest
  // completed run too (M18.134, cp14 F1). A failed query is said, and the unknown rule below applies.
  const completed = await Promise.all(
    WORKFLOWS.map((w) =>
      source.completed(branch, `${w}.yml`).catch((e) => {
        unread.add(w);
        console.log(`last-ci: cannot read ${w}'s newest completed run (${e.message}); only the branch window is read`);
        return [];
      }),
    ),
  );
  runs = withNewestCompleted(await source.branch(branch), completed.flat());
  // an unreadable nightly is said, not a verdict on the task
  nightlyRuns = await source.nightly(branch).catch((e) => e);
} catch (e) {
  // no answer from GitHub is no green either: unknown, which blocks feature rows (M18.128)
  console.log(`last-ci: UNKNOWN cannot read ${branch}'s runs (${e.message}${transportHint()}); check CI by hand`);
  process.exit(UNKNOWN);
}

const newestFirst = [...runs].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
let verdict = 0;
/** Red outranks unknown, unknown outranks a wait (M18.128). */
const worst = (a, b) => [1, UNKNOWN, 2, 0].find((code) => code === a || code === b);
for (const workflow of WORKFLOWS) {
  const mine = newestFirst.filter((r) => r.workflowName === workflow);
  const done = mine.find((r) => r.status === 'completed');
  // only runs started after that one can carry a fix: in newest-first order they come before it (review r2 F1)
  const pending = done === undefined ? mine.length : mine.indexOf(done);
  const tail = pending > 0 ? ` (${pending} newer run${pending === 1 ? '' : 's'} pending)` : '';
  const failing = await pendingRed(workflow, mine.slice(0, pending));
  verdict = worst(verdict, failing.verdict);
  for (const line of failing.lines) console.log(line);
  if (!done && (pending > t('LAST_CI_MAX_PENDING') || unread.has(workflow))) {
    // so many pending runs, or an unread query, and none completed: the last verdict is out of sight, not green (M18.134)
    verdict = worst(verdict, UNKNOWN);
    console.log(`last-ci: UNKNOWN ${workflow}: no completed run found behind ${pending} pending runs on ${branch}; check CI by hand`);
    continue;
  }
  if (!done) {
    console.log(`last-ci: ${workflow} has no completed run on ${branch}${tail}`);
    continue;
  }
  const sha = String(done.headSha).slice(0, 7);
  if ((done.conclusion === 'success' || done.conclusion === 'skipped') && pending > t('LAST_CI_MAX_PENDING')) {
    // a green this far behind says nothing about the runs queued over it (M18.191, cp24 F1)
    verdict = worst(verdict, UNKNOWN);
    console.log(
      `last-ci: UNKNOWN ${workflow}: green at ${sha} (run ${done.databaseId}) is behind ${pending} pending runs, more than ${t('LAST_CI_MAX_PENDING')}; check CI by hand`,
    );
    continue;
  }
  if (done.conclusion === 'success' || done.conclusion === 'skipped') {
    let tree = workflow === 'ci' ? await sameTreeVerdict(workflow, done) : { verdict: 0, lines: [] };
    if (tree.verdict === 1) tree = await intermittentWithPending(tree, mine.slice(0, pending));
    verdict = worst(verdict, tree.verdict);
    for (const line of tree.lines) console.log(line);
    if (tree.verdict === 0) console.log(`last-ci: ${workflow} green at ${sha} (run ${done.databaseId})${tail}`);
    continue;
  }
  if (pending > 0) {
    // a red workflow that blocks (exit 1) outranks a wait (M5.2 review F1)
    const red = await redWithPending(workflow, done, mine.slice(0, pending));
    verdict = worst(verdict, red.verdict);
    console.log(red.line);
    continue;
  }
  verdict = 1;
  console.log(`last-ci: RED ${workflow} ${done.conclusion} at ${sha} (run ${done.databaseId}): fix main's CI before the next task`);
}
/** The cold-setup line of ci's newest completed run, and whether it blocks (by status). */
async function coldSetupReport(run, newer) {
  const where = `at ${String(run.headSha).slice(0, 7)} (run ${run.databaseId})`;
  const cold = await Promise.resolve(source.coldSetup?.(run.databaseId)).catch(() => null);
  if (cold === undefined) return { verdict: 0, line: `last-ci: ci has no cold-setup job ${where}` };
  if (cold === null) return { verdict: 0, line: `last-ci: cold-setup UNKNOWN ${where}: its job could not be read; check it by hand` };
  if (cold.conclusion === 'success') return coldSuccess(cold, where);
  const blame = typeof cold.log === 'string' ? /budget: cold setup failed by (status|time)[^\r\n]*/.exec(cold.log) : null;
  if (!blame)
    return {
      verdict: 0,
      line: `last-ci: cold-setup ${cold.conclusion} ${where}; cause UNKNOWN (log ${cold.log === null ? 'unreadable' : 'without a blame line'}); check it by hand`,
    };
  const text = blame[0].replace(/^budget: /, '');
  // a declared fix of that ci run waits as it does for the run's own red (M18.161 r1 F3)
  if (blame[1] === 'status' && newer.length) {
    // only a fix that names the run: cold-setup's own job is not matched across runs
    const red = await redWithPending('cold-setup', { ...run, conclusion: 'failure' }, newer, []);
    return { verdict: red.verdict, line: `${red.line}; ${text}` };
  }
  if (blame[1] === 'status') return { verdict: 1, line: `last-ci: RED cold-setup ${where}: ${text}; a fresh clone fails, fix it before the next task` };
  return { verdict: 0, line: `last-ci: warning: cold-setup ${where}: ${text}` };
}
/** The cold run's duration in ms and whether the log calls it over budget; ms null when unknown. */
function coldDuration(cold) {
  const log = typeof cold.log === 'string' ? cold.log : '';
  const over =
    /(?:::warning title=cold setup over budget::|##\[warning\])cold setup (\d+) ms >/.exec(log) ?? /budget: cold setup failed by time \((\d+) ms >/.exec(log);
  if (over) return { ms: Number(over[1]), over: true };
  // check-budget's own measure wins over the step's, which also counts the step's start-up
  const within = /budget: cold setup (\d+) ms <= /.exec(log);
  return { ms: within ? Number(within[1]) : Number.isFinite(cold.ms) ? cold.ms : null, over: false };
}
/**
 * A successful cold-setup is green only when its duration is known within budget: the cold step's
 * time, or check-budget's `budget: cold setup N ms <=` line. M18.159's by-time exemption is an overrun,
 * read from the step time, the blame line or the over-budget annotation in either log form
 * (`::warning title=…::` as printed, `##[warning]` as GitHub's downloaded log writes it); anything
 * else is UNKNOWN (M18.164, M18.178).
 */
function coldSuccess(cold, where) {
  const limit = t('COLD_SETUP_MAX_MS');
  const { ms, over } = coldDuration(cold);
  const s = (n) => `${Math.round(n / 1000)} s`;
  if (ms !== null && (over || ms > limit))
    return { verdict: 0, line: `last-ci: warning: cold-setup over budget ${where}: ${s(ms)} > ${s(limit)} (exempt while M18.157 is open)` };
  if (ms !== null) return { verdict: 0, line: `last-ci: cold-setup green ${where} (${s(ms)})` };
  const why = typeof cold.log === 'string' ? 'no step time, no budget line in the log' : 'no step time, log unreadable';
  return { verdict: 0, line: `last-ci: cold-setup success ${where}; duration UNKNOWN (${why}); check it by hand` };
}
const ciRuns = newestFirst.filter((r) => r.workflowName === 'ci');
const ciDone = ciRuns.find((r) => r.status === 'completed');
if (ciDone) {
  const cold = await coldSetupReport(ciDone, ciRuns.slice(0, ciRuns.indexOf(ciDone)));
  verdict = worst(verdict, cold.verdict);
  console.log(cold.line);
}
const newestNightly = Array.isArray(nightlyRuns)
  ? [...nightlyRuns].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).find((r) => r.status === 'completed')
  : undefined;
if (!Array.isArray(nightlyRuns)) console.log(`last-ci: cannot read ${branch}'s nightly runs (${nightlyRuns?.message ?? 'no answer'}); not a verdict`);
else if (newestNightly === undefined) console.log(`last-ci: nightly has no completed run on ${branch}; not a verdict`);
else
  console.log(
    `last-ci: nightly ${newestNightly.conclusion === 'success' ? 'green' : `RED ${newestNightly.conclusion}`} at ${String(newestNightly.headSha).slice(0, 7)} (run ${newestNightly.databaseId}); not a verdict`,
  );
// one rule with landing-block: while a row blocks landing, red does not stop that row or harness-path work (M18.142)
if (verdict === 1) {
  const file = opt('backlog') ?? repoPath('docs', 'backlog', 'current.md');
  const blocking = blockingRows(existsSync(file) ? readFileSync(file, 'utf8') : '').map((r) => r.id);
  if (blocking.length)
    console.log(
      `last-ci: ${blocking.join(', ')} blocks landing (\`blocks-landing\`): only that row and commits confined to HARNESS_PATHS proceed until it is done; other rows wait`,
    );
}
process.exit(verdict);
