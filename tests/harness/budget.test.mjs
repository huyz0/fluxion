// NFR-DX-001 / NFR-DX-002: recorded gate latencies (cold setup, quick, staged) stay within the thresholds.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { harnessFiles, packagingNeeded, testScope } from '../../scripts/gates/ladder-scope.mjs';
import { t } from '../../scripts/gates/thresholds.mjs';
import { WORST_CASE_STAGED } from '../../scripts/gates/worst-case.mjs';
import { out, REPO, sandbox } from './helpers.mjs';

let sb;
const OK = {
  recordedAt: '2026-09-27T00:00:00.000Z',
  commit: 'abc1234',
  node: '22.19.0',
  platform: 'linux-x64',
  quickMs: 2_000,
  stagedMs: 60_000,
  coldSetupMs: 200_000,
  lockfile: 'none', // the sandbox has no pnpm-lock.yaml
};
// CI is pinned: on a CI runner an inherited CI=true would change the lockfile rule (ADR-0143)
const budget = (record, ci = '') => {
  if (record !== undefined) sb.write('budget.json', JSON.stringify(record));
  return sb.node('scripts/gates/check-budget.mjs', ['--file', sb.path('budget.json')], { env: { ...process.env, CI: ci } });
};

describe('check-budget (NFR-DX-001, NFR-DX-002)', () => {
  beforeEach(() => {
    sb = sandbox(['scripts']);
  });
  afterEach(() => sb.cleanup());

  it('passes a record within every threshold', () => {
    const r = budget(OK);
    assert.equal(r.status, 0, out(r));
  });

  const over = {
    'a pre-commit gate over PRECOMMIT_BUDGET_MS': ['stagedMs', t('PRECOMMIT_BUDGET_MS') + 1],
    'a quick gate over QUICK_GATE_BUDGET_MS': ['quickMs', t('QUICK_GATE_BUDGET_MS') + 1],
    'a cold setup over COLD_SETUP_MAX_MS (10 min)': ['coldSetupMs', t('COLD_SETUP_MAX_MS') + 1],
  };
  for (const [name, [key, value]] of Object.entries(over)) {
    it(`fails on ${name}`, () => {
      const r = budget({ ...OK, [key]: value });
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, new RegExp(`${key} ${value} ms > `));
    });
  }

  it('fails when a run failed (null) or the record is missing', () => {
    const failed = budget({ ...OK, coldSetupMs: null });
    assert.equal(failed.status, 1, out(failed));
    assert.match(failed.stderr, /coldSetupMs not recorded/);
    const missing = sb.node('scripts/gates/check-budget.mjs', ['--file', sb.path('nope.json')]);
    assert.equal(missing.status, 1, out(missing));
    assert.match(missing.stderr, /is missing: run check-budget\.mjs --record/);
  });

  it('fails when the record predates the lockfile (M1.19 review F2)', () => {
    sb.write('pnpm-lock.yaml', "lockfileVersion: '9.0'\n");
    const r = budget(OK);
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /predates the current pnpm-lock\.yaml/);
  });

  it('lockfile change in CI: a stale record passes with a note, limits still apply (ADR-0143, NFR-DX-001)', () => {
    sb.write('pnpm-lock.yaml', "lockfileVersion: '9.0'\n");
    const ci = budget(OK, 'true');
    assert.equal(ci.status, 0, out(ci));
    assert.match(ci.stdout, /cold-setup job measures this lockfile \(ADR-0143\)/);
    const over = budget({ ...OK, stagedMs: t('PRECOMMIT_BUDGET_MS') + 1 }, 'true');
    assert.equal(over.status, 1, out(over));
    assert.match(over.stderr, /stagedMs .* ms > /);
    const local = budget(OK, 'false');
    assert.equal(local.status, 1, out(local));
    assert.match(local.stderr, /predates the current pnpm-lock\.yaml/);
  });

  it('NFR-DX-001: a lockfile that differs from the record only in workspace links keeps the record current; an external change does not', () => {
    sb.cleanup();
    sb = sandbox(['scripts'], { git: true });
    const lock = (importers, packages = '') =>
      `lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    dependencies:\n      react:\n        specifier: 19.2.0\n        version: 19.2.0\n${importers}\npackages:\n\n  react@19.2.0:\n    resolution: {integrity: sha512-a}\n${packages}`;
    sb.write('pnpm-lock.yaml', lock(''));
    sb.git('add', 'pnpm-lock.yaml');
    sb.git('commit', '-q', '--no-verify', '-m', 'fixture lockfile');
    const commit = sb.git('rev-parse', 'HEAD').stdout.trim();
    const hash = createHash('sha256')
      .update(readFileSync(sb.path('pnpm-lock.yaml')))
      .digest('hex');
    const record = { ...OK, commit, lockfile: hash };
    assert.equal(budget(record).status, 0);
    // a new workspace: an importer with a link
    sb.write(
      'pnpm-lock.yaml',
      lock("\n  packs/x:\n    dependencies:\n      '@fluxion/sdk':\n        specifier: workspace:*\n        version: link:../../packages/sdk\n"),
    );
    const linked = budget(record);
    assert.equal(linked.status, 0, out(linked));
    // a record whose commit holds another lockfile than the one it measured is not trusted
    const other = budget({ ...record, lockfile: 'f'.repeat(64) });
    assert.equal(other.status, 1, out(other));
    // an external package: the cold setup must be measured again
    sb.write('pnpm-lock.yaml', lock('', '\n  left-pad@1.0.0:\n    resolution: {integrity: sha512-c}\n'));
    const external = budget(record);
    assert.equal(external.status, 1, out(external));
    assert.match(external.stderr, /predates the current pnpm-lock\.yaml/);
  });

  it('the committed record is within the thresholds (cold setup < 10 min, NFR-DX-001)', () => {
    const record = JSON.parse(readFileSync(join(REPO, '.harness/budget.json'), 'utf8'));
    assert.ok(record.coldSetupMs > 0 && record.coldSetupMs <= t('COLD_SETUP_MAX_MS'), JSON.stringify(record));
    assert.ok(record.stagedMs <= t('PRECOMMIT_BUDGET_MS') && record.quickMs <= t('QUICK_GATE_BUDGET_MS'), JSON.stringify(record));
  });

  it('record isolation: --record sets up a fresh clone with an empty store and browsers path, then runs verify (NFR-DX-001)', () => {
    sb.cleanup();
    sb = coldSandbox();
    const r = sb.node('scripts/gates/check-budget.mjs', ['--record', '--file', sb.path('budget.json')], { env: fakeEnv(sb) });
    assert.equal(r.status, 0, out(r));
    const calls = pnpmCalls(sb);
    assert.deepEqual(
      calls.map((c) => c.args),
      [['install', '--frozen-lockfile', '--store-dir', calls[0]?.rawStore], ['run', 'setup'], ['verify']],
      'pnpm i --frozen-lockfile, pnpm run setup, pnpm verify, in that order',
    );
    const tmp = dirname(calls[0].cwd);
    for (const c of calls) {
      // a fresh clone outside the working tree, so nothing installed here is reused
      assert.equal(c.cwd, join(tmp, 'repo'), JSON.stringify(c));
      assert.ok(!c.cwd.startsWith(sb.dir), `measured in the working tree: ${c.cwd}`);
      // an empty store and browser cache of this run, never the machine's
      assert.equal(c.store, join(tmp, 'store'), JSON.stringify(c));
      assert.equal(c.browsers, join(tmp, 'browsers'), JSON.stringify(c));
    }
    assert.equal(calls[0].storeExisted, false, 'the store is empty (absent) before the install');
    // the working tree's uncommitted lockfile is what the clone installs and what the record describes
    const lock = createHash('sha256')
      .update(readFileSync(sb.path('pnpm-lock.yaml')))
      .digest('hex');
    assert.equal(calls[0].lockfile, lock);
    assert.equal(calls[2].budget?.lockfile, lock, "the clone's verify sees a provisional record for this lockfile");
    assert.ok(!existsSync(tmp), 'the temp clone, store and browsers are removed');
    const record = JSON.parse(sb.read('budget.json'));
    assert.equal(record.lockfile, lock);
    for (const k of ['quickMs', 'stagedMs', 'coldSetupMs']) assert.equal(typeof record[k], 'number', `${k}: ${JSON.stringify(record)}`);

    // an install that left the temporary store unused measured nothing cold
    const reused = sb.node('scripts/gates/check-budget.mjs', ['--record', '--file', sb.path('budget.json')], {
      env: fakeEnv(sb, { FAKE_PNPM_NO_STORE: '1' }),
    });
    assert.equal(reused.status, 1, out(reused));
    assert.match(reused.stderr, /did not use the temporary store/);
    assert.equal(JSON.parse(sb.read('budget.json')).coldSetupMs, null);
  });

  it('cold setup recorded from a CI run: --cold-from-ci takes the cold-setup step of a green ci run of that lockfile (ADR-0145)', () => {
    sb.cleanup();
    sb = coldSandbox();
    sb.git('checkout', '--', 'pnpm-lock.yaml'); // the working tree carries HEAD's lockfile
    const head = sb.git('rev-parse', 'HEAD').stdout.trim();
    const step = { name: 'cold setup within COLD_SETUP_MAX_MS', conclusion: 'success', startedAt: '2026-09-27T23:12:24Z', completedAt: '2026-09-27T23:14:52Z' };
    const ciRun = (conclusion) => [{ databaseId: 7, workflowName: 'ci', headSha: head, conclusion, jobs: [{ name: 'cold-setup', conclusion, steps: [step] }] }];
    const record = (runs) => {
      sb.write('runs.json', JSON.stringify(runs));
      const args = ['--record', '--cold-from-ci', 'HEAD', '--runs-file', sb.path('runs.json'), '--file', sb.path('budget.json')];
      return sb.node('scripts/gates/check-budget.mjs', args, { env: { ...fakeEnv(sb), CI: '' } });
    };

    const ok = record(ciRun('success'));
    assert.equal(ok.status, 0, out(ok));
    const rec = JSON.parse(sb.read('budget.json'));
    assert.equal(rec.coldSetupMs, 148_000, 'the step took 2 min 28 s');
    assert.equal(rec.coldSetupSource, 'ci:7');
    const lock = createHash('sha256')
      .update(readFileSync(sb.path('pnpm-lock.yaml')))
      .digest('hex');
    assert.equal(rec.lockfile, lock);
    assert.deepEqual(pnpmCalls(sb), [], 'no local cold clone');

    const red = record(ciRun('failure'));
    assert.equal(red.status, 1, out(red));
    assert.match(red.stderr, /no green ci run of [0-9a-f]{7}/);
    sb.write('pnpm-lock.yaml', "lockfileVersion: '9.0'\n# not what HEAD's run installed\n");
    const other = record(ciRun('success'));
    assert.equal(other.status, 1, out(other));
    assert.match(other.stderr, /has another pnpm-lock\.yaml than the tree being recorded/);
    assert.equal(JSON.parse(sb.read('budget.json')).coldSetupMs, null);

    // the step this mode reads is the one ci.yml runs
    assert.match(
      readFileSync(join(REPO, '.github/workflows/ci.yml'), 'utf8'),
      /- name: cold setup within COLD_SETUP_MAX_MS\n\s+run: node scripts\/gates\/check-budget\.mjs --cold/,
    );
  });

  it('pending cold setup: --cold-pending carries the number; staged and CI accept it, a local full check does not (ADR-0145)', () => {
    sb.cleanup();
    sb = coldSandbox(); // the working tree has an uncommitted lockfile change, as in a lockfile commit
    sb.write('budget.json', JSON.stringify({ ...OK, coldSetupMs: 130_000, coldSetupSource: 'local' }));
    const rec = sb.node('scripts/gates/check-budget.mjs', ['--record', '--cold-pending', '--file', sb.path('budget.json')], {
      env: { ...fakeEnv(sb), CI: 'true' },
    });
    assert.equal(rec.status, 0, out(rec));
    const pending = JSON.parse(sb.read('budget.json'));
    assert.equal(pending.coldSetupMs, 130_000, 'the previous number is carried');
    assert.equal(pending.coldSetupSource, 'pending-ci');
    assert.deepEqual(pnpmCalls(sb), [], 'no local cold clone');
    assert.deepEqual(sb.read('ladder.log').trim().split('\n'), [
      '--quick --no-review --no-budget',
      `--staged --no-review --no-budget --staged-paths ${WORST_CASE_STAGED.join(',')}`,
    ]);
    const check = (args, ci) => sb.node('scripts/gates/check-budget.mjs', ['--file', sb.path('budget.json'), ...args], { env: { ...process.env, CI: ci } });
    assert.equal(check(['--staged'], '').status, 0, 'the staged ladder accepts it');
    assert.equal(check([], 'true').status, 0, 'CI accepts it');
    const local = check([], '');
    assert.equal(local.status, 1, out(local));
    assert.match(local.stderr, /cold setup pending CI: after the push run check-budget\.mjs --record --cold-from-ci/);
    // nothing to carry: the record cannot be made
    sb.write('budget.json', JSON.stringify({ ...OK, coldSetupMs: null }));
    const none = sb.node('scripts/gates/check-budget.mjs', ['--record', '--cold-pending', '--file', sb.path('budget.json')], { env: fakeEnv(sb) });
    assert.equal(none.status, 1, out(none));
    assert.match(none.stderr, /no previous cold-setup number to carry/);
  });

  it('staged lockfile runs the budget step; other staged commits skip it (ADR-0145)', () => {
    sb.cleanup();
    sb = sandbox(undefined, { git: true });
    const budgetLine = () =>
      sb
        // CI pinned: an inherited CI=true would accept the old record (ADR-0143; M3.5 review r2 F1)
        .node('scripts/gates/precommit.mjs', ['--staged', '--summary', '--no-review'], { env: { ...process.env, CI: '' } })
        .stdout.split(/\r?\n/)
        .find((l) => / budget\b/.test(l) && /^(PASS|FAIL|SKIP) /.test(l));
    // a workspace, so the step is available and really runs check-budget (not SKIP)
    sb.write('package.json', '{}\n');
    sb.write('turbo.json', '{}\n');
    sb.write('notes.txt', 'x\n');
    sb.git('add', 'notes.txt');
    assert.equal(budgetLine(), undefined, 'no lockfile staged: the step does not apply');
    const lock = "lockfileVersion: '9.0'\n";
    sb.write('pnpm-lock.yaml', lock);
    sb.git('add', 'pnpm-lock.yaml');
    const hash = createHash('sha256').update(lock).digest('hex');
    // a pending-ci record for the staged lockfile passes only through check-budget --staged
    sb.write('.harness/budget.json', JSON.stringify({ ...OK, lockfile: hash, coldSetupSource: 'pending-ci' }));
    assert.match(String(budgetLine()), /^PASS budget\b/);
    // the old record fails the commit
    sb.write('.harness/budget.json', JSON.stringify(OK));
    assert.match(String(budgetLine()), /^FAIL budget\b/);
    // an inherited CI=true does not relax the staged check (M3.5 review r3 F2)
    const underCi = sb.node('scripts/gates/precommit.mjs', ['--staged', '--summary', '--no-review'], { env: { ...process.env, CI: 'true' } }).stdout;
    assert.match(underCi, /^FAIL budget\b/m);
    // --no-budget (the ladder check-budget --record times) leaves it out
    const noBudget = sb.node('scripts/gates/precommit.mjs', ['--staged', '--summary', '--no-review', '--no-budget'], {
      env: { ...process.env, CI: '' },
    }).stdout;
    assert.doesNotMatch(noBudget, /^(PASS|FAIL|SKIP) budget\b/m);
  });

  it('--cold measures only the isolated cold setup, writes no record, and fails when the setup fails (NFR-DX-001)', () => {
    sb.cleanup();
    sb = coldSandbox();
    const ok = sb.node('scripts/gates/check-budget.mjs', ['--cold', '--file', sb.path('budget.json')], { env: fakeEnv(sb) });
    assert.equal(ok.status, 0, out(ok));
    assert.match(ok.stdout, new RegExp(`budget: cold setup \\d+ ms <= ${t('COLD_SETUP_MAX_MS')} ms`));
    assert.deepEqual(
      pnpmCalls(sb).map((c) => c.args[0]),
      ['install', 'run', 'verify'],
    );
    assert.ok(!existsSync(sb.path('budget.json')), '--cold writes no record');
    const failed = sb.node('scripts/gates/check-budget.mjs', ['--cold'], { env: fakeEnv(sb, { FAKE_PNPM_FAIL: 'verify' }) });
    assert.equal(failed.status, 1, out(failed));
    assert.match(failed.stderr, /cold run failed[\s\S]*fake verify failed/);
  });

  it("NFR-DX-002: the recorded staged time is the worst-case commit's", () => {
    const all = readdirSync(join(REPO, 'tests/harness'))
      .filter((f) => f.endsWith('.test.mjs'))
      .map((f) => `tests/harness/${f}`);
    const workspaces = JSON.parse(readFileSync(join(REPO, 'tools/gen/workspaces.json'), 'utf8')).workspaces;
    const browserTested = workspaces.filter(({ dir }) => /(editor|render|player)$/.test(dir)).map(({ dir }) => dir);
    // what the worst-case commit stages makes the staged ladder run every harness file, the packaging checks and the whole Vitest run with the browser project
    assert.deepEqual(harnessFiles(WORST_CASE_STAGED, all), all, 'every harness file');
    assert.equal(packagingNeeded(WORST_CASE_STAGED), true, 'the packaging checks');
    assert.deepEqual(testScope(WORST_CASE_STAGED, workspaces, browserTested), { run: true, browser: true }, 'the whole Vitest run, browser project included');
    // no ordinary commit is the worst case: a sources-only one runs far less
    assert.notDeepEqual(harnessFiles(['packages/core/src/x.ts'], all), all);
    // the ladder honours --staged-paths (the record test above sees check-budget pass it)
    const ladder = readFileSync(join(REPO, 'scripts/gates/precommit.mjs'), 'utf8');
    assert.match(ladder, /process\.argv\.includes\('--staged-paths'\)/);
    assert.match(ladder, /const stagedPaths = \(\) => pretended \?\? /);
  });
});

// A fake pnpm, first on PATH: logs each call (args, cwd, store, browsers path, the clone's lockfile
// hash and budget record), creates the --store-dir on install, fails the command in FAKE_PNPM_FAIL.
const FAKE_PNPM = `import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
const args = process.argv.slice(2);
const store = process.env.pnpm_config_store_dir;
const read = (p) => (existsSync(p) ? readFileSync(p) : null);
const lock = read('pnpm-lock.yaml');
const budget = read('.harness/budget.json');
// resolved like process.cwd() (macOS: /var is a link to /private/var, M2.28); the parent exists
const real = (p) => p && join(realpathSync(dirname(p)), basename(p));
const call = { args, cwd: process.cwd(), rawStore: store, store: real(store), browsers: real(process.env.PLAYWRIGHT_BROWSERS_PATH), storeExisted: existsSync(store),
  lockfile: lock && createHash('sha256').update(lock).digest('hex'), budget: budget && JSON.parse(budget) };
appendFileSync(process.env.FAKE_PNPM_LOG, JSON.stringify(call) + '\\n');
if (args[0] === process.env.FAKE_PNPM_FAIL) {
  console.error('fake ' + args[0] + ' failed');
  process.exit(1);
}
if (args[0] === 'install' && !process.env.FAKE_PNPM_NO_STORE) mkdirSync(args[args.indexOf('--store-dir') + 1], { recursive: true });
`;

const LADDER_STUB = `import { appendFileSync } from 'node:fs';
appendFileSync(process.env.FAKE_LADDER_LOG, process.argv.slice(2).join(' ') + '\\n');
`;

/** A git sandbox with a stub ladder, an uncommitted lockfile change and the fake pnpm in bin/. */
function coldSandbox() {
  const s = sandbox(['scripts', '.harness/state.json'], { git: true });
  s.write('pnpm-lock.yaml', "lockfileVersion: '9.0'\n");
  s.git('add', 'pnpm-lock.yaml');
  s.git('commit', '-q', '--no-verify', '-m', 'fixture lockfile');
  // the timed ladder: logs its arguments (--record must pass --no-budget, M3.5 review F1)
  s.write('scripts/gates/precommit.mjs', LADDER_STUB);
  s.write('pnpm-lock.yaml', "lockfileVersion: '9.0'\n# uncommitted change\n");
  s.write('bin/fake-pnpm.mjs', FAKE_PNPM);
  s.write('bin/pnpm', `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/fake-pnpm.mjs" "$@"\n`);
  chmodSync(s.path('bin/pnpm'), 0o755);
  s.write('bin/pnpm.cmd', `@"${process.execPath}" "%~dp0fake-pnpm.mjs" %*\r\n`);
  return s;
}

/** process.env with the fake pnpm first on PATH (whatever the key's case on Windows). */
function fakeEnv(s, extra = {}) {
  const key = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  return {
    ...process.env,
    [key]: `${s.path('bin')}${delimiter}${process.env[key] ?? ''}`,
    FAKE_PNPM_LOG: s.path('pnpm.log'),
    FAKE_LADDER_LOG: s.path('ladder.log'),
    ...extra,
  };
}

/** The fake pnpm's calls since the last read. */
function pnpmCalls(s) {
  const lines = existsSync(s.path('pnpm.log')) ? s.read('pnpm.log').split('\n').filter(Boolean) : [];
  s.write('pnpm.log', '');
  return lines.map((l) => JSON.parse(l));
}
