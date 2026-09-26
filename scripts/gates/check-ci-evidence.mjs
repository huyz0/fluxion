#!/usr/bin/env node
// CI evidence (M1.24, M1 cp1 F2; NFR-PORT-005, NFR-SEC-005): a local ladder cannot prove the three-OS
// CI matrix is green, so a record names the GitHub runs that did, and this gate re-reads them live.
//   check-ci-evidence.mjs --record <sha>   write .harness/reviews/ci-evidence.json from the successful
//                                          gates and ci runs of <sha> (needs gh, authenticated)
//   check-ci-evidence.mjs                  verify the record against GitHub: each run succeeded, ran
//                                          <sha>, and every OS job passed; <sha> is at or after the
//                                          commit of --after (default M1.21)
//   --file <f>        another record (tests)
//   --runs-file <f>   JSON array of `gh run view --json databaseId,workflowName,headSha,conclusion,jobs`
//                     objects used instead of gh (tests)
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { git, repoPath } from './lib.mjs';

const argv = process.argv.slice(2);
const opt = (k) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const file = opt('file') ?? repoPath('.harness', 'reviews', 'ci-evidence.json');
const after = opt('after') ?? 'M1.21';
const OSES = ['ubuntu-latest', 'windows-latest', 'macos-latest'];
// workflow -> the matrix job that must pass on every OS
const REQUIRED = { gates: 'gates', ci: 'verify' };
const FIELDS = 'databaseId,workflowName,headSha,conclusion,jobs';

const fail = (msg) => {
  console.error(`ci-evidence: ${msg}`);
  process.exit(1);
};

function gh(args) {
  const r = spawnSync('gh', args, { encoding: 'utf8' });
  if (r.error || r.status !== 0) fail(`gh ${args.slice(0, 2).join(' ')} failed (installed and authenticated?): ${(r.stderr || r.error?.message || '').trim()}`);
  return JSON.parse(r.stdout);
}
const fixture = opt('runs-file') ? JSON.parse(readFileSync(opt('runs-file'), 'utf8')) : null;
const view = (id) =>
  fixture?.find((r) => r.databaseId === id) ?? (fixture ? fail(`run ${id} not in --runs-file`) : gh(['run', 'view', String(id), '--json', FIELDS]));

/** Problems with one run for `sha`, [] when it is the evidence we need. */
function problems(run, workflow, sha) {
  const out = [];
  if (run.workflowName !== workflow) out.push(`run ${run.databaseId} is workflow ${run.workflowName}, not ${workflow}`);
  if (run.headSha !== sha) out.push(`run ${run.databaseId} ran ${String(run.headSha).slice(0, 7)}, not ${sha.slice(0, 7)}`);
  if (run.conclusion !== 'success') out.push(`${workflow} run ${run.databaseId} concluded ${run.conclusion}`);
  for (const os of OSES) {
    const job = (run.jobs ?? []).find((j) => j.name === `${REQUIRED[workflow]} (${os})`);
    if (job?.conclusion !== 'success') out.push(`${workflow}: job ${REQUIRED[workflow]} (${os}) ${job ? job.conclusion : 'missing'}`);
  }
  return out;
}

if (argv.includes('--record')) {
  const sha = git(['rev-parse', opt('record') ?? 'HEAD']).stdout.trim();
  const listed = fixture ?? gh(['run', 'list', '--commit', sha, '--limit', '50', '--json', 'databaseId,workflowName,conclusion']);
  const runs = {};
  for (const workflow of Object.keys(REQUIRED)) {
    const hit = listed.find((r) => r.workflowName === workflow && r.conclusion === 'success');
    if (!hit) fail(`no successful ${workflow} run for ${sha.slice(0, 7)} yet`);
    runs[workflow] = hit.databaseId;
  }
  writeFileSync(file, `${JSON.stringify({ sha, recordedAt: new Date().toISOString(), runs }, null, 2)}\n`);
  console.log(`ci-evidence: recorded ${sha.slice(0, 7)} ${JSON.stringify(runs)}`);
}

if (!existsSync(file)) fail(`${file} is missing: after a green push run check-ci-evidence.mjs --record <sha>`);
const record = JSON.parse(readFileSync(file, 'utf8'));
const errors = [];
const base = git(['log', '-1', '--format=%H', '--grep', `^${after.replace('.', '\\.')}:`]).stdout.trim();
if (!base) errors.push(`no ${after} commit in history`);
else if (git(['merge-base', '--is-ancestor', base, record.sha]).status !== 0)
  errors.push(`${String(record.sha).slice(0, 7)} is not at or after ${after} (${base.slice(0, 7)})`);
for (const workflow of Object.keys(REQUIRED)) {
  const id = record.runs?.[workflow];
  if (!id) errors.push(`no ${workflow} run recorded`);
  else errors.push(...problems(view(id), workflow, record.sha));
}
if (errors.length) fail(errors.join('\n  '));
console.log(`ci-evidence: ${String(record.sha).slice(0, 7)} green on ${OSES.join(', ')} (gates ${record.runs.gates}, ci ${record.runs.ci})`);
