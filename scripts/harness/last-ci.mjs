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
// stands in for GitHub in --runs-file.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { runSource, transportHint } from '../gates/ci-runs.mjs';
import { blockingRows } from '../gates/landing-block.mjs';
import { repoPath } from '../gates/lib.mjs';
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

/** How a red completed run with `newer` pending runs is reported: exit 2 (wait) only for a declared, bounded fix. */
function redWithPending(workflow, done, newer, sha) {
  const head = `last-ci: RED ${workflow} ${done.conclusion} at ${sha} (run ${done.databaseId}) (${newer.length} newer run${newer.length === 1 ? '' : 's'} pending)`;
  const fix = newer.findLast((r) => declared(messageOf(r)).includes(String(done.databaseId)));
  if (fix === undefined) return { verdict: 1, line: `${head}: none declares Fixes-ci: ${done.databaseId}; fix main's CI before the next task` };
  if (newer.length > t('LAST_CI_MAX_PENDING'))
    return { verdict: 1, line: `${head}: more than ${t('LAST_CI_MAX_PENDING')} runs pending on one red; stop landing and fix main's CI` };
  const waited = now - Date.parse(fix.createdAt);
  if (!(waited <= t('LAST_CI_MAX_WAIT_MS')))
    return {
      verdict: 1,
      line: `${head}: the declared fix (run ${fix.databaseId}) has been pending over ${t('LAST_CI_MAX_WAIT_MS') / 60000} min; check it by hand`,
    };
  return { verdict: 2, line: `${head}: wait for the declared fix (run ${fix.databaseId}), then run last-ci again` };
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
    branch: async () => pushes.filter((r) => !r.outsideWindow),
    completed: async (_, file) => {
      const workflow = file.replace(/\.yml$/, '');
      if (all.some((r) => r.queryFails && r.workflowName === workflow)) throw new Error('query failed');
      return [newest(pushes.filter((r) => r.workflowName === workflow && r.status === 'completed'))].filter(Boolean);
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
/** Workflows whose status-filtered query failed: no completed run in the window is then unknown, not "none yet" (r1 F2). */
const unread = new Set();
try {
  source = opt('runs-file') ? fileSource(JSON.parse(readFileSync(opt('runs-file'), 'utf8'))) : runSource();
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
  if (done.conclusion === 'success' || done.conclusion === 'skipped') {
    console.log(`last-ci: ${workflow} green at ${sha} (run ${done.databaseId})${tail}`);
    continue;
  }
  if (pending > 0) {
    // a red workflow that blocks (exit 1) outranks a wait (M5.2 review F1)
    const red = redWithPending(workflow, done, mine.slice(0, pending), sha);
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
    const red = redWithPending('cold-setup', { ...run, conclusion: 'failure' }, newer, String(run.headSha).slice(0, 7));
    return { verdict: red.verdict, line: `${red.line}; ${text}` };
  }
  if (blame[1] === 'status') return { verdict: 1, line: `last-ci: RED cold-setup ${where}: ${text}; a fresh clone fails, fix it before the next task` };
  return { verdict: 0, line: `last-ci: warning: cold-setup ${where}: ${text}` };
}
/** A successful cold-setup is green only when known within budget; M18.159's by-time exemption is an overrun (M18.164). */
function coldSuccess(cold, where) {
  const limit = t('COLD_SETUP_MAX_MS');
  const log = typeof cold.log === 'string' ? cold.log : '';
  const warned = /::warning title=cold setup over budget::cold setup (\d+) ms/.exec(log);
  const ms = warned ? Number(warned[1]) : cold.ms;
  if (warned || (Number.isFinite(ms) && ms > limit))
    return {
      verdict: 0,
      line: `last-ci: warning: cold-setup over budget ${where}: ${Math.round(ms / 1000)} s > ${limit / 1000} s (exempt while M18.157 is open)`,
    };
  if (!Number.isFinite(ms) && typeof cold.log !== 'string')
    return { verdict: 0, line: `last-ci: cold-setup success ${where}; duration UNKNOWN (no step time, log unreadable); check it by hand` };
  return { verdict: 0, line: `last-ci: cold-setup green ${where}${Number.isFinite(ms) ? ` (${Math.round(ms / 1000)} s)` : ''}` };
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
