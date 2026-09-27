#!/usr/bin/env node
// Gate latency budget (NFR-DX-001, NFR-DX-002).
//   check-budget.mjs            the recorded timings in .harness/budget.json are within the thresholds
//   check-budget.mjs --record   measure and record them: quick gate, staged pre-commit gate, and a cold
//                               setup (fresh local clone: pnpm i --frozen-lockfile, pnpm run setup,
//                               pnpm verify); takes minutes
//   check-budget.mjs --cold     measure only the cold setup, the same isolated way, and fail when it
//                               fails or takes over COLD_SETUP_MAX_MS; writes nothing (ci.yml cold-setup)
//   check-budget.mjs --file <f> check another record (tests)
// The ladder also fails any staged or quick run over its budget as it happens (precommit.mjs); this
// step keeps the cold-setup measurement, which no single run can see, honest and on record.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git, repoPath, run } from './lib.mjs';
import { t } from './thresholds.mjs';

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

if (argv.includes('--record')) {
  const ladder = (mode) =>
    timed(() => spawnSync(process.execPath, [repoPath('scripts/gates/precommit.mjs'), mode, '--no-review'], { encoding: 'utf8', cwd: repoPath() }));
  const quick = ladder('--quick');
  const staged = ladder('--staged');
  // the clone's budget step sees this run's quick/staged numbers; the cold setup being measured is
  // stood in for by its limit (the committed-record test requires a positive number within it)
  const cold = coldSetup({ recordedAt: new Date().toISOString(), quickMs: quick.ms, stagedMs: staged.ms, coldSetupMs: LIMITS.coldSetupMs });
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
// or a heavier install could pass on an old number forever (M1.19 review F2)
if (record.lockfile !== lockfileHash()) problems.push('the record predates the current pnpm-lock.yaml: run check-budget.mjs --record');
if (problems.length) {
  for (const p of problems) console.error(`budget: ${p}`);
  process.exit(1);
}
console.log(
  `budget: quick ${record.quickMs} ms, staged ${record.stagedMs} ms, cold setup ${record.coldSetupMs} ms (recorded ${record.recordedAt} at ${String(record.commit).slice(0, 7)})`,
);
