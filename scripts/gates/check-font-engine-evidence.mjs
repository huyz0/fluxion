#!/usr/bin/env node
// Font-engine rebuild evidence (M18.109, cp11 F6; NFR-SEC-001, ADR-0051): woff2-codec.wasm is committed as bytes, and only a
// rebuild with the pinned toolchain from the pinned checkouts shows those bytes are what the recipe makes. The font-engine
// workflow does that rebuild on GitHub; a record names its run, and this gate re-reads the run live.
//   check-font-engine-evidence.mjs --record <run-id>   write .harness/reviews/font-engine-evidence.json from that run
//   check-font-engine-evidence.mjs                     verify the record: the run is the font-engine workflow and its rebuild job
//                                                      passed; the workflow at the run's commit rebuilds and compares the codec;
//                                                      the committed codec bytes, their recorded hash, the pins (toolchain,
//                                                      sources, wrapper) and the recipe (build and rebuild scripts, workflow,
//                                                      wrapper source) are the same at that commit, an ancestor of HEAD, and now
//   --file <f>        another record (tests)
//   --runs-file <f>   JSON array of `gh run view --json databaseId,workflowName,headSha,conclusion,jobs` objects (tests)
// GitHub is read through `gh` when installed, else the REST API (ci-runs.mjs).
import { readFileSync, writeFileSync } from 'node:fs';
import { runSource, transportHint } from './ci-runs.mjs';
import { git, repoPath } from './lib.mjs';

const argv = process.argv.slice(2);
const opt = (k) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const file = opt('file') ?? repoPath('.harness', 'reviews', 'font-engine-evidence.json');
const WORKFLOW = 'font-engine';
const JOB = 'rebuild';
const WORKFLOW_FILE = '.github/workflows/font-engine.yml';
const REBUILD = 'scripts/ci/font-engine-rebuild.mjs';
/** The files that build and compare the codec, besides its wrapper source. */
const RECIPE = ['scripts/fonts/build-font-engine.mjs', REBUILD, WORKFLOW_FILE];
const ASSETS = 'packages/format/assets/font-engine';
const CODEC = 'woff2-codec.wasm';

const fail = (msg) => {
  console.error(`font-engine-evidence: ${msg}`);
  process.exit(1);
};

const fixture = opt('runs-file') ? JSON.parse(readFileSync(opt('runs-file'), 'utf8')) : null;
const source = fixture ? null : runSource();
const view = async (id) => {
  if (!fixture) return source.view(id);
  const r = fixture.find((x) => x.databaseId === id);
  if (!r) throw new Error(`run ${id} not in --runs-file`);
  if (r.error) throw new Error(r.error);
  return r;
};

/** `path` at `rev` (a commit, or '' for the index), or undefined when it does not exist there. */
const show = (rev, path) => {
  const r = git(['show', `${rev}:${path}`]);
  return r.status === 0 ? r.stdout : undefined;
};
/** The git blob id of `path` at `rev`, or undefined. */
const blob = (rev, path) => {
  const r = git(['rev-parse', '--verify', '--quiet', `${rev}:${path}`]);
  return r.status === 0 ? r.stdout.trim() : undefined;
};
/** What the rebuild depends on, from the manifest text: the codec's hash, its pins and the toolchain. */
const pinsOf = (text) => {
  const m = JSON.parse(text);
  const codec = m.assets.find((a) => a.file === CODEC);
  return { sha256: codec?.sha256, pins: JSON.stringify({ toolchain: m.toolchain, sources: codec?.sources, wrapper: codec?.wrapper }) };
};

/** Problems with `run` as the rebuild of record `sha`. */
function runProblems(run, record) {
  const out = [];
  if (run.workflowName !== WORKFLOW) out.push(`run ${record.run} is workflow ${run.workflowName}, not ${WORKFLOW}`);
  if (run.headSha !== record.sha) out.push(`run ${record.run} ran ${String(run.headSha).slice(0, 7)}, not ${String(record.sha).slice(0, 7)}`);
  const job = (run.jobs ?? []).find((j) => j.name === JOB);
  if (job?.conclusion !== 'success') out.push(`${WORKFLOW}: job ${JOB} ${job ? job.conclusion : 'missing'}`);
  return out;
}

/** Problems with the workflow at `sha`: a comment naming the command is not running it, so a step must call the rebuild script, and that script must check. */
function workflowProblems(sha) {
  const workflow = show(sha, WORKFLOW_FILE);
  if (workflow === undefined) return [`${WORKFLOW_FILE} does not exist at ${sha.slice(0, 7)}`];
  const steps = workflow.split(/\r?\n/).filter((l) => /^\s*(?:- )?run:/.test(l));
  const script = show(sha, REBUILD) ?? '';
  if (steps.some((l) => l.includes(`node ${REBUILD}`)) && /\bcheck --sources\b/.test(script)) return [];
  return [`${WORKFLOW_FILE} at ${sha.slice(0, 7)} does not run ${REBUILD} with build-font-engine.mjs check: its success is no rebuild`];
}

/** Problems with the codec at the record's commit against now: its recorded hash, its manifest hash and pins, and its bytes. */
function codecProblems(record, then) {
  const now = show('', `${ASSETS}/manifest.json`) ?? readFileSync(repoPath(ASSETS, 'manifest.json'), 'utf8');
  const [a, b] = [pinsOf(then), pinsOf(now)];
  const out = [];
  if (a.sha256 !== record.codecSha256) out.push(`the record names codec ${record.codecSha256}, the manifest at its commit ${a.sha256}`);
  if (a.sha256 !== b.sha256) out.push(`the committed codec hash changed since the rebuild (${a.sha256} then, ${b.sha256} now): rebuild again`);
  if (a.pins !== b.pins) out.push('the toolchain, source or wrapper pins changed since the rebuild: rebuild again');
  const rebuilt = blob(record.sha, `${ASSETS}/${CODEC}`);
  if (!rebuilt || rebuilt !== blob('', `${ASSETS}/${CODEC}`)) out.push(`${CODEC} bytes differ from the ones the run rebuilt and compared: rebuild again`);
  return out;
}

/** Problems with the recipe that built and compared: a run of another compare, flags or wrapper is no evidence for today's bytes. */
function recipeProblems(sha, then) {
  const wrapper = JSON.parse(then).assets.find((x) => x.file === CODEC)?.wrapper;
  return [...RECIPE, ...(wrapper ? [`${ASSETS}/${wrapper}`] : [])]
    .filter((path) => {
      const was = blob(sha, path);
      return !was || was !== blob('', path);
    })
    .map((path) => `${path} changed since the rebuild: rebuild again`);
}

/** Problems with the commit the run rebuilt: on this branch, its workflow rebuilds and compares, and its codec, pins and recipe are today's. */
function commitProblems(record) {
  const sha = String(record.sha);
  const out = workflowProblems(sha);
  // a run of a commit this branch does not contain (a dispatched branch) proves nothing about what it holds
  if (git(['merge-base', '--is-ancestor', sha, 'HEAD']).status !== 0)
    out.push(`${sha.slice(0, 7)} is not an ancestor of HEAD: record a run of a commit on this branch`);
  const then = show(sha, `${ASSETS}/manifest.json`);
  if (then === undefined) return [...out, `the font-engine manifest does not exist at ${sha.slice(0, 7)}`];
  return [...out, ...codecProblems(record, then), ...recipeProblems(sha, then)];
}

if (argv.includes('--record')) {
  const id = Number(opt('record'));
  if (!Number.isInteger(id) || id <= 0) fail('usage: check-font-engine-evidence.mjs --record <run-id>');
  let run;
  try {
    run = await view(id);
  } catch (e) {
    fail(`reading run ${id} failed: ${e?.message ?? e}${fixture ? '' : transportHint()}`);
  }
  const manifest = show(run.headSha, `${ASSETS}/manifest.json`);
  if (manifest === undefined) fail(`run ${id}'s commit ${String(run.headSha).slice(0, 7)} is not in this clone or has no font-engine manifest`);
  const record = { run: id, sha: run.headSha, codecSha256: pinsOf(manifest).sha256, recordedAt: new Date().toISOString() };
  const problems = [...runProblems(run, record), ...commitProblems(record)];
  if (problems.length) fail(problems.join('\n  '));
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`font-engine-evidence: recorded run ${id} on ${record.sha.slice(0, 7)}`);
  process.exit(0);
}

let record;
try {
  record = JSON.parse(readFileSync(file, 'utf8'));
} catch {
  fail(`${file} is missing: run the font-engine workflow, then check-font-engine-evidence.mjs --record <run-id>`);
}
if (!record?.run || !record.sha || !record.codecSha256) fail(`${file} needs run, sha and codecSha256`);
const errors = [];
try {
  errors.push(...runProblems(await view(record.run), record));
} catch (e) {
  errors.push(`reading run ${record.run} failed: ${e?.message ?? e}${fixture ? '' : transportHint()}`);
}
errors.push(...commitProblems(record));
if (errors.length) fail(errors.join('\n  '));
console.log(
  `font-engine-evidence: run ${record.run} rebuilt ${CODEC} ${record.codecSha256.slice(0, 12)} on ${record.sha.slice(0, 7)} with the pinned toolchain`,
);
