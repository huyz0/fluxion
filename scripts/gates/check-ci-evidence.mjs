#!/usr/bin/env node
// CI evidence (M1.24, M1 cp1 F2; NFR-PORT-005, NFR-SEC-005): a local ladder cannot prove the three-OS
// CI matrix is green, so a record names the GitHub runs that did, and this gate re-reads them live.
//   check-ci-evidence.mjs --record <sha>   write .harness/reviews/ci-evidence.json from the successful
//                                          gates and ci runs of <sha>
//   check-ci-evidence.mjs                  verify the record against GitHub: each run succeeded, ran
//                                          <sha>, ci's verify passed on every OS and the ubuntu gates
//                                          job passed; <sha> is at or after the commit of --after
//                                          (default M1.21)
//   --milestone M<n>  instead of --after: <sha> must be at or after M<n>'s final review range end, or,
//                     before that review exists, HEAD's last non-bookkeeping commit, so the evidence
//                     cannot go stale behind later code (M2.20, M1 final F3)
//   --file <f>        another record (tests)
//   --runs-file <f>   JSON array of `gh run view --json databaseId,workflowName,headSha,conclusion,jobs`
//                     objects used instead of GitHub (tests)
// GitHub is read through `gh` when installed, else the REST API (GITHUB_TOKEN sent when set; ci-runs.mjs).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { runSource, transportHint } from './ci-runs.mjs';
import { git, repoPath } from './lib.mjs';
import { BOOKKEEPING_PATHS } from './milestone-checks.mjs';

const argv = process.argv.slice(2);
const opt = (k) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const file = opt('file') ?? repoPath('.harness', 'reviews', 'ci-evidence.json');
const after = opt('after') ?? 'M1.21';
const milestone = opt('milestone');
const OSES = ['ubuntu-latest', 'windows-latest', 'macos-latest'];
// workflow -> the jobs that must pass, each as its accepted names. ci's verify matrix is the one
// three-OS ladder, and its visual job the pinned-image screenshot check; gates is ubuntu-only since M2.22 (`gates`), earlier runs named it `gates (ubuntu-latest)`.
const REQUIRED = {
  gates: [['gates', 'gates (ubuntu-latest)']],
  // the visual job compares screenshots with their baselines: pixel matches are evidence too (M5.3)
  // the Lighthouse job is the editor's time to interactive against EDITOR_TTI_MS (NFR-SIZE-002, M11.19)
  ci: [...OSES.map((os) => [`verify (${os})`]), ['visual'], ['lighthouse']],
};

const fail = (msg) => {
  console.error(`ci-evidence: ${msg}`);
  process.exit(1);
};

const fixture = opt('runs-file') ? JSON.parse(readFileSync(opt('runs-file'), 'utf8')) : null;
const source = fixture ? null : runSource();
const live = (call) => call().catch((e) => fail(`${e.message}${transportHint()}`));
// a fixture entry with `error` stands for a transport failure (tests)
const fromFixture = (id) => {
  const r = fixture.find((x) => x.databaseId === id);
  if (!r) throw new Error(`run ${id} not in --runs-file`);
  if (r.error) throw new Error(r.error);
  return r;
};
// throws on a transport failure; the check reports it with every other problem (M2 final F5)
const view = async (id) => (fixture ? fromFixture(id) : source.view(id));
const list = async (sha) => fixture ?? live(() => source.list(sha));

/** Problems with one run for `sha`, [] when it is the evidence we need. */
function problems(run, workflow, sha) {
  const out = [];
  if (run.workflowName !== workflow) out.push(`run ${run.databaseId} is workflow ${run.workflowName}, not ${workflow}`);
  if (run.headSha !== sha) out.push(`run ${run.databaseId} ran ${String(run.headSha).slice(0, 7)}, not ${sha.slice(0, 7)}`);
  if (run.conclusion !== 'success') out.push(`${workflow} run ${run.databaseId} concluded ${run.conclusion}`);
  for (const names of REQUIRED[workflow]) {
    const job = (run.jobs ?? []).find((j) => names.includes(j.name));
    if (job?.conclusion !== 'success') out.push(`${workflow}: job ${job?.name ?? names[0]} ${job ? job.conclusion : 'missing'}`);
  }
  return out;
}

/** HEAD's newest commit touching a path outside BOOKKEEPING_PATHS (the list the final-review range check uses). */
function lastCodeCommit() {
  // \x01 marks each commit: unlike '@', it cannot occur in a path
  const log = git(['log', '--format=%x01%H', '--name-only', 'HEAD']).stdout;
  for (const entry of log.split('\x01').filter(Boolean)) {
    const [sha, ...paths] = entry.split(/\r?\n/).filter(Boolean);
    if (paths.some((p) => !BOOKKEEPING_PATHS.some((re) => re.test(p)))) return sha;
  }
  return '';
}

/** [label, sha] the recorded sha must be at or after; sha is '' when it cannot be found. */
function floor() {
  if (!milestone) return [after, git(['log', '-1', '--format=%H', '--grep', `^${after.replace('.', '\\.')}:`]).stdout.trim()];
  const review = repoPath('.harness', 'reviews', `milestone-${milestone}-final.json`);
  if (!existsSync(review)) return [`HEAD's last non-bookkeeping commit (no ${milestone} final review yet)`, lastCodeCommit()];
  const end = /\.\.([0-9a-f]{7,40})$/.exec(JSON.parse(readFileSync(review, 'utf8')).range ?? '')?.[1] ?? '';
  return [`the final review range end of ${milestone}`, end];
}

if (argv.includes('--record')) {
  const sha = git(['rev-parse', opt('record') ?? 'HEAD']).stdout.trim();
  const listed = await list(sha);
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
const [label, base] = floor();
if (!base) errors.push(`${label}: no such commit`);
else if (git(['merge-base', '--is-ancestor', base, record.sha]).status !== 0)
  errors.push(`${String(record.sha).slice(0, 7)} is not at or after ${label} (${base.slice(0, 7)})`);
for (const workflow of Object.keys(REQUIRED)) {
  const id = record.runs?.[workflow];
  if (!id) errors.push(`no ${workflow} run recorded`);
  else {
    try {
      errors.push(...problems(await view(id), workflow, record.sha));
    } catch (e) {
      errors.push(`reading ${workflow} run ${id} failed: ${e?.message ?? e}${fixture ? '' : transportHint()}`);
    }
  }
}
if (errors.length) fail(errors.join('\n  '));
console.log(`ci-evidence: ${String(record.sha).slice(0, 7)} green on ${OSES.join(', ')} (gates ${record.runs.gates}, ci ${record.runs.ci})`);
