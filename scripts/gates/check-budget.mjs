#!/usr/bin/env node
// Gate latency budget (NFR-DX-001, NFR-DX-002).
//   check-budget.mjs            the recorded timings in .harness/budget.json are within the thresholds
//   check-budget.mjs --record   measure and record them: quick gate, staged pre-commit gate (on the worst-case
//                               commit, worst-case.mjs), and a cold
//                               setup (fresh local clone: pnpm i --frozen-lockfile, pnpm run setup,
//                               pnpm verify); takes minutes
//   check-budget.mjs --cold     measure only the cold setup, the same isolated way, and fail when it
//                               fails or takes over COLD_SETUP_MAX_MS; writes nothing (ci.yml cold-setup)
//   check-budget.mjs --record --cold-from-ci <sha>
//                               as --record, but the cold setup is the duration of the cold-setup step of
//                               <sha>'s green ci run (ADR-0145), so a machine that cannot download
//                               Chromium can still record; <sha> must have the lockfile being recorded
//   check-budget.mjs --record --cold-pending
//                               for the commit that changes pnpm-lock.yaml where no cold setup can run:
//                               quick and staged measured, the previous cold-setup number carried and
//                               marked pending-ci; after the push, --cold-from-ci <that sha> replaces it
//   check-budget.mjs --staged   the staged ladder's check: a pending-ci record is accepted (ADR-0145)
//   check-budget.mjs --runs-file <f>  runs in the `gh run view --json …,jobs` shape instead of GitHub (tests)
//   check-budget.mjs --file <f> check another record (tests)
// The ladder also fails any staged or quick run over its budget as it happens (precommit.mjs); this
// step keeps the cold-setup measurement, which no single run can see, honest and on record.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSource } from './ci-runs.mjs';
import { lockfileWorkspaceOnly } from './ladder-scope.mjs';
import { git, repoPath, run } from './lib.mjs';
import { t } from './thresholds.mjs';
import { WORST_CASE_STAGED } from './worst-case.mjs';

const argv = process.argv.slice(2);
const opt = (k) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const file = opt('file') ?? repoPath('.harness', 'budget.json');
const LIMITS = { quickMs: t('QUICK_GATE_BUDGET_MS'), stagedMs: t('PRECOMMIT_BUDGET_MS'), coldSetupMs: t('COLD_SETUP_MAX_MS') };

/** sha256 of pnpm-lock.yaml ("none" without one): ties a record to the dependency set it measured. */
function lockfileHash(root = repoPath()) {
  const lock = join(root, 'pnpm-lock.yaml');
  return existsSync(lock) ? createHash('sha256').update(readFileSync(lock)).digest('hex') : 'none';
}

const timed = (fn, lockfile) => {
  const t0 = Date.now();
  const r = fn();
  return { ms: Date.now() - t0, ok: r.status === 0, lockfile, tail: `${r.stdout ?? ''}\n${r.stderr ?? ''}`.trim().split(/\r?\n/).slice(-15).join('\n') };
};

/**
 * Cold setup of the tree the record will describe: a fresh clone of HEAD plus the working tree's
 * tracked changes, so a staged lockfile change is measured, not HEAD's (M1.19 review r3 F1).
 * `provisional` is written as the clone's .harness/budget.json so its verify checks this run's
 * numbers instead of failing on the record being replaced.
 */
function coldSetup(provisional) {
  const dir = mkdtempSync(join(tmpdir(), 'fluxion-cold-'));
  try {
    // core.autocrlf=false: the clone's bytes (lockfile hash included) equal the repo's on every OS (M2.28)
    const clone = git(['clone', '--quiet', '--no-hardlinks', '--config', 'core.autocrlf=false', repoPath(), join(dir, 'repo')]);
    if (clone.status !== 0) return { ms: 0, ok: false, tail: clone.stderr };
    const cwd = join(dir, 'repo');
    // a hook's GIT_DIR / GIT_INDEX_FILE must not point the clone's git and pnpm at this repo
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') || k === 'GIT_EXEC_PATH'));
    // raw bytes: a utf8 round-trip would corrupt binary hunks
    const diff = spawnSync('git', ['diff', 'HEAD', '--binary'], { cwd: repoPath(), maxBuffer: 1 << 30 }).stdout;
    if (diff.length) {
      const patch = join(dir, 'wt.patch');
      writeFileSync(patch, diff);
      const applied = run('git', ['apply', '--whitespace=nowarn', patch], { cwd, env: clean });
      if (applied.status !== 0) return { ms: 0, ok: false, tail: applied.stderr };
    }
    const lockfile = lockfileHash(cwd);
    writeFileSync(join(cwd, '.harness', 'budget.json'), `${JSON.stringify({ ...provisional, lockfile }, null, 2)}\n`);
    // really cold: an empty pnpm store and browser cache, so registry and Chromium downloads count (M1.19 review F1)
    const env = {
      ...clean,
      // pnpm 11 reads pnpm_config_*, not npm_config_* (M1.19 review r2); --store-dir below makes it explicit
      pnpm_config_store_dir: join(dir, 'store'),
      PLAYWRIGHT_BROWSERS_PATH: join(dir, 'browsers'),
    };
    return timed(() => {
      for (const args of [['install', '--frozen-lockfile', '--store-dir', join(dir, 'store')], ['run', 'setup'], ['verify']]) {
        const r = run('pnpm', args, { cwd, env });
        if (r.status !== 0) return r;
      }
      // proof the install downloaded into the empty store instead of reusing the machine's
      if (!existsSync(join(dir, 'store'))) return { status: 1, stdout: '', stderr: 'the cold install did not use the temporary store' };
      return { status: 0, stdout: '', stderr: '' };
    }, lockfile);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
}

/** Threshold problems of `record` for the LIMITS keys in `keys`. */
const limitProblems = (record, keys = Object.keys(LIMITS)) =>
  keys.flatMap((key) => {
    const v = record[key];
    if (typeof v !== 'number') return [`${key} not recorded (the run failed or never ran): run check-budget.mjs --record`];
    return v > LIMITS[key] ? [`${key} ${v} ms > ${LIMITS[key]} ms`] : [];
  });

// CI (NFR-DX-001): a fresh runner measures the cold setup itself; the clone's budget step sees
// stand-ins at the limits, as in --record, because no quick/staged run happens here
if (argv.includes('--cold')) {
  const cold = coldSetup({ recordedAt: new Date().toISOString(), quickMs: LIMITS.quickMs, stagedMs: LIMITS.stagedMs, coldSetupMs: LIMITS.coldSetupMs });
  if (!cold.ok) console.error(`budget: cold run failed\n${cold.tail}`);
  const problems = limitProblems({ coldSetupMs: cold.ok ? cold.ms : null }, ['coldSetupMs']);
  for (const p of problems) console.error(`budget: ${p}`);
  if (!problems.length)
    console.log(`budget: cold setup ${cold.ms} ms <= ${LIMITS.coldSetupMs} ms (empty store: pnpm i --frozen-lockfile, pnpm run setup, pnpm verify)`);
  process.exit(problems.length ? 1 : 0);
}

// ci.yml's cold-setup job runs check-budget --cold in this step; its duration is the measurement
const COLD_STEP = 'cold setup within COLD_SETUP_MAX_MS';

/** GitHub runs, or the --runs-file fixture in the same shape. */
function runs() {
  const fixture = opt('runs-file') ? JSON.parse(readFileSync(opt('runs-file'), 'utf8')) : null;
  if (!fixture) return runSource();
  return { list: async (sha) => fixture.filter((r) => r.headSha === sha), view: async (id) => fixture.find((r) => r.databaseId === id) };
}

/** The successful cold-setup step of a green ci run of `commit`, or null. */
async function coldStep(source, commit) {
  const green = (await source.list(commit)).filter((r) => r.workflowName === 'ci' && r.conclusion === 'success');
  for (const { databaseId } of green) {
    const job = (await source.view(databaseId))?.jobs?.find((j) => j.name === 'cold-setup' && j.conclusion === 'success');
    const step = job?.steps?.find((s) => s.name === COLD_STEP && s.conclusion === 'success');
    if (step) return { runId: databaseId, ms: Date.parse(step.completedAt) - Date.parse(step.startedAt) };
  }
  return null;
}

/**
 * Cold setup taken from CI (ADR-0145): the cold-setup step of `sha`'s green ci run, which measured
 * that commit on a fresh runner. `sha` must carry the lockfile of the tree being recorded.
 */
async function ciColdSetup(sha) {
  const rev = git(['rev-parse', '--verify', `${sha}^{commit}`]);
  if (rev.status !== 0) return { ok: false, tail: `${sha} is not a commit` };
  const commit = rev.stdout.trim();
  // raw blob bytes, as lockfileHash reads the file
  const blob = spawnSync('git', ['show', `${commit}:pnpm-lock.yaml`], { cwd: repoPath(), maxBuffer: 1 << 30 });
  const lockfile = blob.status === 0 ? createHash('sha256').update(blob.stdout).digest('hex') : 'none';
  if (lockfile !== lockfileHash()) return { ok: false, lockfile, tail: `${commit.slice(0, 7)} has another pnpm-lock.yaml than the tree being recorded` };
  try {
    const step = await coldStep(runs(), commit);
    if (!step) return { ok: false, lockfile, tail: `no green ci run of ${commit.slice(0, 7)} with a successful "${COLD_STEP}" step` };
    return { ok: true, ms: step.ms, lockfile, source: `ci:${step.runId}` };
  } catch (e) {
    return { ok: false, lockfile, tail: `reading CI runs failed: ${e?.message ?? e}` };
  }
}

const PENDING = 'pending-ci';

/** --cold-pending: the previous record's cold-setup number, carried for the current lockfile. */
function carriedColdSetup() {
  const previous = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  if (typeof previous.coldSetupMs !== 'number') return { ok: false, lockfile: lockfileHash(), tail: 'no previous cold-setup number to carry' };
  return { ok: true, ms: previous.coldSetupMs, lockfile: lockfileHash() };
}

if (argv.includes('--record')) {
  // --no-budget: the timed ladder must not check the record being replaced (with the lockfile staged
  // it would run against the old record and fail; M3.5 review F1)
  const args = (mode, more) => [repoPath('scripts/gates/precommit.mjs'), mode, '--no-review', '--no-budget', ...more];
  const ladder = (mode, more = []) => timed(() => spawnSync(process.execPath, args(mode, more), { encoding: 'utf8', cwd: repoPath() }));
  const quick = ladder('--quick');
  // the staged ladder is timed on the worst-case commit, not on what happens to be staged (NFR-DX-002, M8.20)
  const staged = ladder('--staged', ['--staged-paths', WORST_CASE_STAGED.join(',')]);
  const fromCi = opt('cold-from-ci');
  const pending = argv.includes('--cold-pending');
  // the clone's budget step sees this run's quick/staged numbers; the cold setup being measured is
  // stood in for by its limit (the committed-record test requires a positive number within it)
  const cold = fromCi
    ? await ciColdSetup(fromCi)
    : pending
      ? carriedColdSetup()
      : coldSetup({ recordedAt: new Date().toISOString(), quickMs: quick.ms, stagedMs: staged.ms, coldSetupMs: LIMITS.coldSetupMs });
  for (const [name, m] of Object.entries({ quick, staged, cold })) if (!m.ok) console.error(`budget: ${name} run failed\n${m.tail}`);
  const record = {
    recordedAt: new Date().toISOString(),
    commit: git(['rev-parse', 'HEAD']).stdout.trim(),
    // the lockfile of the tree actually measured (HEAD + working-tree changes), not read again afterwards
    lockfile: cold.lockfile ?? lockfileHash(),
    node: process.versions.node,
    platform: `${process.platform}-${process.arch}`,
    quickMs: quick.ok ? quick.ms : null,
    stagedMs: staged.ok ? staged.ms : null,
    coldSetupMs: cold.ok ? cold.ms : null,
    coldSetupSource: fromCi ? (cold.source ?? null) : pending ? PENDING : 'local',
  };
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`budget: recorded ${JSON.stringify(record)}`);
}

if (!existsSync(file)) {
  console.error(`budget: ${file} is missing: run check-budget.mjs --record`);
  process.exit(1);
}
const record = JSON.parse(readFileSync(file, 'utf8'));
const problems = limitProblems(record);
// a record describes one dependency set: after a lockfile change the cold setup must be re-measured,
// or a heavier install could pass on an old number forever (M1.19 review F2). Inside CI the same
// run's cold-setup job (check-budget --cold, needed by ci-ok) measures the new lockfile live, so a
// stale record is noted, not failed (ADR-0143); local runs still require a fresh record.
// the staged ladder only runs from a local hook: an inherited CI=true there must not accept a stale
// record (M3.5 review r3 F2), or a lockfile commit could skip ADR-0145's pending record
const inCi = /^(1|true)$/i.test(process.env.CI ?? '') && !argv.includes('--staged');
/**
 * Whether the lockfile differs from the record's only in workspace links: the install of external packages, which the cold-setup
 * time measures, is the same (a new workspace adds an importer and links, nothing to download). Read from the record's commit.
 */
function sameDependencies() {
  const then = measuredLockfile();
  return then !== undefined && existsSync(repoPath('pnpm-lock.yaml')) && lockfileWorkspaceOnly(then, readFileSync(repoPath('pnpm-lock.yaml'), 'utf8'));
}
/**
 * The lockfile the record measured: the one at its commit, or, for a record taken with a lockfile change staged (--cold-pending), the
 * one the next commit on HEAD's history that changed pnpm-lock.yaml committed. Either blob must hash to the record's lockfile, or the
 * record's number belongs to another dependency set.
 */
function measuredLockfile() {
  const next = git(['log', '--reverse', '--format=%H', `${record.commit}..HEAD`, '--', 'pnpm-lock.yaml']);
  const commits = [record.commit, ...(next.status === 0 ? next.stdout.split(/\r?\n/).filter(Boolean).slice(0, 1) : [])];
  for (const commit of commits) {
    const blob = git(['show', `${commit}:pnpm-lock.yaml`]);
    if (blob.status === 0 && createHash('sha256').update(blob.stdout).digest('hex') === record.lockfile) return blob.stdout;
  }
  return undefined;
}
if (record.lockfile !== lockfileHash() && !sameDependencies()) {
  if (inCi) console.log('budget: the record predates pnpm-lock.yaml; in CI the cold-setup job measures this lockfile (ADR-0143)');
  else problems.push('the record predates the current pnpm-lock.yaml: run check-budget.mjs --record (or, without Chromium, --record --cold-pending; ADR-0145)');
}
// a pending-ci record (ADR-0145) belongs to a lockfile commit whose cold setup CI measures after the
// push: the staged ladder and CI accept it; a local full ladder or completion gate asks for the CI number
if (record.coldSetupSource === PENDING) {
  if (inCi || argv.includes('--staged')) console.log('budget: cold setup pending CI (ADR-0145)');
  else problems.push('cold setup pending CI: after the push run check-budget.mjs --record --cold-from-ci <sha of the commit that carries this pnpm-lock.yaml>');
}
if (problems.length) {
  for (const p of problems) console.error(`budget: ${p}`);
  process.exit(1);
}
console.log(
  `budget: quick ${record.quickMs} ms, staged ${record.stagedMs} ms, cold setup ${record.coldSetupMs} ms (recorded ${record.recordedAt} at ${String(record.commit).slice(0, 7)})`,
);
