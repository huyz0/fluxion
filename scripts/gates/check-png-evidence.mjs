#!/usr/bin/env node
// PNG decoder evidence (M19.52, cp6 F1): the nightly's png-check job runs the pixel specs with each screenshot also decoded by the
// browser (FLUXION_PNG_CHECK=1, M19.27). A workflow that holds the job proves nothing until it has run green; a record names the
// run, and m19-complete's decodePng leg reads it.
//   check-png-evidence.mjs --record <run-id>   write .harness/reviews/png-check-evidence.json from that nightly run, refused unless its
//                                              png-check job concluded success on a commit at or after 819cfaf on this branch, whose
//                                              nightly.yml runs the job with FLUXION_PNG_CHECK=1 and --retries=0
//   check-png-evidence.mjs                     check the record (milestone-checks checkPngEvidence)
//   --file <f>        another record (tests)
//   --runs-file <f>   JSON array of `gh run view --json databaseId,workflowName,headSha,conclusion,jobs` objects (tests)
import { readFileSync, writeFileSync } from 'node:fs';
import { runSource, transportHint } from './ci-runs.mjs';
import { git, repoPath } from './lib.mjs';
import { checkPngEvidence } from './milestone-checks.mjs';

const argv = process.argv.slice(2);
const opt = (k) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const file = opt('file') ?? repoPath('.harness', 'reviews', 'png-check-evidence.json');
const fail = (msg) => {
  console.error(`png-evidence: ${msg}`);
  process.exit(1);
};

/** Problems with nightly.yml at `sha`: the png-check job must run the specs with the browser decode and no retry. */
function workflowProblems(sha) {
  const r = git(['show', `${sha}:.github/workflows/nightly.yml`]);
  if (r.status !== 0) return [`nightly.yml cannot be read at ${sha.slice(0, 7)}`];
  const job = /^ {2}png-check:\n([\s\S]*?)(?=^ {2}\S|(?![\s\S]))/m.exec(r.stdout)?.[1] ?? '';
  const out = [];
  if (!/FLUXION_PNG_CHECK:\s*['"]?1/.test(job)) out.push(`nightly.yml at ${sha.slice(0, 7)} has no png-check job with FLUXION_PNG_CHECK=1`);
  if (!/playwright test\b.*--retries[= ]0\b/.test(job)) out.push(`nightly.yml at ${sha.slice(0, 7)} runs png-check without --retries=0`);
  return out;
}

if (argv.includes('--record')) {
  const id = Number(opt('record'));
  if (!Number.isInteger(id) || id <= 0) fail('usage: check-png-evidence.mjs --record <run-id>');
  const fixture = opt('runs-file') ? JSON.parse(readFileSync(opt('runs-file'), 'utf8')) : null;
  let run;
  try {
    run = fixture ? fixture.find((x) => x.databaseId === id) : await runSource().view(id);
    if (!run) throw new Error(`run ${id} not in --runs-file`);
  } catch (e) {
    fail(`reading run ${id} failed: ${e?.message ?? e}${fixture ? '' : transportHint()}`);
  }
  const job = (run.jobs ?? []).find((j) => j.name === 'png-check');
  const record = {
    run: id,
    sha: run.headSha,
    workflow: run.workflowName,
    job: 'png-check',
    conclusion: job?.conclusion ?? 'missing',
    recordedAt: new Date().toISOString(),
  };
  const verdict = checkPngEvidence(record);
  const problems = [...(verdict === true ? [] : [verdict]), ...workflowProblems(String(run.headSha))];
  if (problems.length) fail(problems.join('\n  '));
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`png-evidence: recorded nightly run ${id} (png-check success on ${record.sha.slice(0, 7)})`);
  process.exit(0);
}

let record;
try {
  record = JSON.parse(readFileSync(file, 'utf8'));
} catch {
  fail(`${file} is missing: after a green nightly, check-png-evidence.mjs --record <run-id>`);
}
const verdict = checkPngEvidence(record);
if (verdict !== true) fail(verdict);
console.log(`png-evidence: nightly run ${record.run} passed png-check on ${String(record.sha).slice(0, 7)}`);
