#!/usr/bin/env node
// Whether a ci run is a real red run of the branch (M18.192, cp24 F3): the `Fixes-ci: <id>` that lets a
// planned fix land through `blocks-landing` must name one. Exit 0 when run <id> is a ci or gates run whose
// conclusion, or one of whose jobs (a run still pending, M18.191), is failure, timed_out or
// startup_failure, and whose head commit is `--since` or an ancestor of it; exit 1, with the reason on
// stderr, otherwise, including when the run cannot be read.
//   node scripts/gates/ci-run-red.mjs <id> --since <sha> [--runs-file <f>]
// --runs-file: a JSON array in `gh run view --json databaseId,workflowName,headSha,conclusion,jobs` shape (tests).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { runSource } from './ci-runs.mjs';

const FAILED = new Set(['failure', 'timed_out', 'startup_failure']);
const argv = process.argv.slice(2);
const opt = (k) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const id = argv[0];
const since = opt('since');
const refuse = (why) => {
  console.error(`ci-run-red: run ${id} ${why}`);
  process.exit(1);
};
if (!/^\d+$/.test(id ?? '') || !since) refuse('usage: ci-run-red.mjs <id> --since <sha> [--runs-file <f>]');
let run;
try {
  run = opt('runs-file') ? JSON.parse(readFileSync(opt('runs-file'), 'utf8')).find((r) => String(r.databaseId) === id) : await runSource().view(id);
} catch (e) {
  refuse(`cannot be read (${e.message})`);
}
if (!run) refuse('was not found');
if (!['ci', 'gates'].includes(run.workflowName)) refuse(`is a ${run.workflowName} run, not ci or gates`);
const failedJobs = (run.jobs ?? []).filter((j) => FAILED.has(j.conclusion)).map((j) => j.name);
if (!FAILED.has(run.conclusion) && failedJobs.length === 0) refuse(`is not red (conclusion ${run.conclusion ?? 'pending'}, no failed job)`);
const onBranch = spawnSync('git', ['merge-base', '--is-ancestor', String(run.headSha), since], { encoding: 'utf8' });
if (onBranch.status !== 0) refuse(`ran on ${String(run.headSha).slice(0, 7)}, which is not on the branch it lands on`);
console.log(`ci-run-red: run ${id} is red at ${String(run.headSha).slice(0, 7)}`);
