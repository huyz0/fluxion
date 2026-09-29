#!/usr/bin/env node
// Main's CI before a task (M5.2, M4 final F3): the drive and next-task loops run this first. For each
// required workflow (ci, gates) it reads the newest *completed* run on the branch; a run that did not
// succeed blocks the next task (exit 1) until it is fixed, so a platform break cannot sit under a
// stack of later commits. When a newer run of that workflow is still pending (the fix is pushed and
// running), it exits 2: wait for that run, do not fix again. An older red run that a newer green one
// replaced does not block. Exit 0: every workflow is green or has no completed run yet.
//   node scripts/harness/last-ci.mjs [--branch main] [--runs-file <json>]
// --runs-file: a JSON array of runs in `gh run list --json databaseId,workflowName,headSha,status,
// conclusion,createdAt` shape, used instead of GitHub (tests).
import { readFileSync } from 'node:fs';
import { runSource, transportHint } from '../gates/ci-runs.mjs';

const WORKFLOWS = ['ci', 'gates'];
const argv = process.argv.slice(2);
const opt = (k) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const branch = opt('branch') ?? 'main';

let runs;
try {
  runs = opt('runs-file') ? JSON.parse(readFileSync(opt('runs-file'), 'utf8')) : await runSource().branch(branch);
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
    // the fix may already be running: wait for it instead of fixing again (M5.2 review F1)
    // a red workflow with nothing pending (exit 1) outranks a wait
    if (verdict === 0) verdict = 2;
    console.log(`last-ci: RED ${workflow} ${done.conclusion} at ${sha} (run ${done.databaseId})${tail}: wait for the pending run, then run last-ci again`);
    continue;
  }
  verdict = 1;
  console.log(`last-ci: RED ${workflow} ${done.conclusion} at ${sha} (run ${done.databaseId}): fix main's CI before the next task`);
}
process.exit(verdict);
