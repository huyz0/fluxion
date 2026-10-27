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
//   node scripts/harness/last-ci.mjs [--branch main] [--runs-file <json>] [--now <iso>] [--offline]
// --runs-file: a JSON array of runs in `gh run list --json databaseId,workflowName,headSha,status,
// conclusion,createdAt` shape, used instead of GitHub (tests; `outsideWindow` marks a run only the
// status-filtered query sees); a run's optional `message` stands in
// for its commit message, which is otherwise read from the local clone, fetching an unseen head from origin
// unless --offline.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { runSource, transportHint } from '../gates/ci-runs.mjs';
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
    nightly: async () => all.filter((r) => r.workflowName === 'nightly'),
  };
}

let runs;
let nightlyRuns;
/** Workflows whose status-filtered query failed: no completed run in the window is then unknown, not "none yet" (r1 F2). */
const unread = new Set();
try {
  const source = opt('runs-file') ? fileSource(JSON.parse(readFileSync(opt('runs-file'), 'utf8'))) : runSource();
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
const newestNightly = Array.isArray(nightlyRuns)
  ? [...nightlyRuns].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).find((r) => r.status === 'completed')
  : undefined;
if (!Array.isArray(nightlyRuns)) console.log(`last-ci: cannot read ${branch}'s nightly runs (${nightlyRuns?.message ?? 'no answer'}); not a verdict`);
else if (newestNightly === undefined) console.log(`last-ci: nightly has no completed run on ${branch}; not a verdict`);
else
  console.log(
    `last-ci: nightly ${newestNightly.conclusion === 'success' ? 'green' : `RED ${newestNightly.conclusion}`} at ${String(newestNightly.headSha).slice(0, 7)} (run ${newestNightly.databaseId}); not a verdict`,
  );
process.exit(verdict);
