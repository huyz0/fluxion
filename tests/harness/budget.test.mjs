// NFR-DX-001 / NFR-DX-002: recorded gate latencies (cold setup, quick, staged) stay within the thresholds.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { t } from '../../scripts/gates/thresholds.mjs';
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
const budget = (record) => {
  if (record !== undefined) sb.write('budget.json', JSON.stringify(record));
  return sb.node('scripts/gates/check-budget.mjs', ['--file', sb.path('budget.json')]);
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
      [['install', '--frozen-lockfile', '--store-dir', calls[0]?.store], ['run', 'setup'], ['verify']],
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
});

// A fake pnpm, first on PATH: logs each call (args, cwd, store, browsers path, the clone's lockfile
// hash and budget record), creates the --store-dir on install, fails the command in FAKE_PNPM_FAIL.
const FAKE_PNPM = `import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
const args = process.argv.slice(2);
const store = process.env.pnpm_config_store_dir;
const read = (p) => (existsSync(p) ? readFileSync(p) : null);
const lock = read('pnpm-lock.yaml');
const budget = read('.harness/budget.json');
const call = { args, cwd: process.cwd(), store, browsers: process.env.PLAYWRIGHT_BROWSERS_PATH, storeExisted: existsSync(store),
  lockfile: lock && createHash('sha256').update(lock).digest('hex'), budget: budget && JSON.parse(budget) };
appendFileSync(process.env.FAKE_PNPM_LOG, JSON.stringify(call) + '\\n');
if (args[0] === process.env.FAKE_PNPM_FAIL) {
  console.error('fake ' + args[0] + ' failed');
  process.exit(1);
}
if (args[0] === 'install' && !process.env.FAKE_PNPM_NO_STORE) mkdirSync(args[args.indexOf('--store-dir') + 1], { recursive: true });
`;

/** A git sandbox with a stub ladder, an uncommitted lockfile change and the fake pnpm in bin/. */
function coldSandbox() {
  const s = sandbox(['scripts', '.harness/state.json'], { git: true });
  s.write('pnpm-lock.yaml', "lockfileVersion: '9.0'\n");
  s.git('add', 'pnpm-lock.yaml');
  s.git('commit', '-q', '--no-verify', '-m', 'fixture lockfile');
  s.write('scripts/gates/precommit.mjs', 'process.exit(0);\n');
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
  return { ...process.env, [key]: `${s.path('bin')}${delimiter}${process.env[key] ?? ''}`, FAKE_PNPM_LOG: s.path('pnpm.log'), ...extra };
}

/** The fake pnpm's calls since the last read. */
function pnpmCalls(s) {
  const lines = existsSync(s.path('pnpm.log')) ? s.read('pnpm.log').split('\n').filter(Boolean) : [];
  s.write('pnpm.log', '');
  return lines.map((l) => JSON.parse(l));
}
