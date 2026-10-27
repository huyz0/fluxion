#!/usr/bin/env node
// Main's CI before a task (M5.2, M4 final F3): the drive and next-task loops run this first. For each
// required workflow (ci, gates) it reads the newest *completed* run on the branch; a run that did not
// succeed blocks the next task (exit 1) until it is fixed, so a platform break cannot sit under a
// stack of later commits. A newer pending run is a fix only when its commit declares it with a
// `Fixes-ci: <run-id>` trailer naming that red run (M18.118, cp12 F2): then it exits 2, wait for that
// run, do not fix again. Any other pending run is ordinary work landing on red and does not hide it;
// nor does a declared fix once more than LAST_CI_MAX_PENDING runs are pending on the same red, or
// once the fix has been pending for LAST_CI_MAX_WAIT_MS. An older red run that a newer green one
// replaced does not block. Exit 0: every workflow is green or has no completed run yet. The nightly's latest
// completed run is reported too, never as a verdict: its failures do not block a task (nightly.yml), but its
// state is what the final mutation and nightly rows read (M18.124).
//   node scripts/harness/last-ci.mjs [--branch main] [--runs-file <json>] [--now <iso>]
// --runs-file: a JSON array of runs in `gh run list --json databaseId,workflowName,headSha,status,
// conclusion,createdAt` shape, used instead of GitHub (tests); a run's optional `message` stands in
// for its commit message, which is otherwise read from the local clone (`git fetch` first).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { runSource, transportHint } from '../gates/ci-runs.mjs';
import { t } from '../gates/thresholds.mjs';

const WORKFLOWS = ['ci', 'gates'];
const argv = process.argv.slice(2);
const opt = (k) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const branch = opt('branch') ?? 'main';
const now = opt('now') ? Date.parse(opt('now')) : Date.now();

/** The commit message of a run's head: its `message` field, else the local clone's copy ('' when unknown). */
function messageOf(r) {
  if (typeof r.message === 'string') return r.message;
  const shown = spawnSync('git', ['show', '-s', '--format=%B', String(r.headSha)], { encoding: 'utf8' });
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

let runs;
let nightlyRuns;
try {
  if (opt('runs-file')) {
    const all = JSON.parse(readFileSync(opt('runs-file'), 'utf8'));
    [runs, nightlyRuns] = [all.filter((r) => r.workflowName !== 'nightly'), all.filter((r) => r.workflowName === 'nightly')];
  } else {
    const source = runSource();
    runs = await source.branch(branch);
    // an unreadable nightly is said, not a verdict on the task
    nightlyRuns = await source.nightly(branch).catch((e) => e);
  }
} catch (e) {
  // no answer from GitHub is not a verdict: say so and do not block the loop on the network
  console.log(`last-ci: cannot read ${branch}'s runs (${e.message}${transportHint()}); check CI by hand`);
  process.exit(0);
}

const newestFirst = [...runs].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
let verdict = 0;
for (const workflow of WORKFLOWS) {
  const mine = newestFirst.filter((r) => r.workflowName === workflow);
  const done = mine.find((r) => r.status === 'completed');
  // only runs started after that one can carry a fix: in newest-first order they come before it (review r2 F1)
  const pending = done === undefined ? mine.length : mine.indexOf(done);
  const tail = pending > 0 ? ` (${pending} newer run${pending === 1 ? '' : 's'} pending)` : '';
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
    verdict = red.verdict === 1 ? 1 : verdict || 2;
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
