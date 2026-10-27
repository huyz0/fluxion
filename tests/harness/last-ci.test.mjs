// M5.2 (M4 final F3, NFR-DX-003): the loop reads main's last CI before a task.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { cleanEnv, REPO } from './helpers.mjs';

/** Runs last-ci.mjs against `runs` (gh run list shape); returns its status and output. */
function lastCi(runs, now = '2026-09-29T03:30:00Z', cwd = undefined) {
  const dir = mkdtempSync(join(tmpdir(), 'last-ci-'));
  try {
    const file = join(dir, 'runs.json');
    writeFileSync(file, JSON.stringify(runs));
    const r = spawnSync(process.execPath, [join(REPO, 'scripts/harness/last-ci.mjs'), '--runs-file', file, '--now', now, '--offline'], {
      encoding: 'utf8',
      cwd,
      env: cleanEnv(),
    });
    return { status: r.status, out: r.stdout + r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
/** A run in gh shape; `state` is the conclusion of a completed run, or queued / in_progress; `extra` is a head sha or overrides. */
const run = (workflowName, state, createdAt, extra = {}) => {
  const pending = state === 'queued' || state === 'in_progress';
  const over = typeof extra === 'string' ? { headSha: extra } : extra;
  const base = { databaseId: createdAt.length, workflowName, headSha: 'abcdef1234567', status: pending ? state : 'completed' };
  return { ...base, conclusion: pending ? null : state, createdAt, ...over };
};

describe('last-ci (M5.2, M4 final F3)', () => {
  it('a red last run on main blocks the next task', () => {
    const r = lastCi([
      run('ci', 'failure', '2026-09-29T02:00:00Z', 'deadbee0000000'),
      run('ci', 'success', '2026-09-29T01:00:00Z'),
      run('gates', 'success', '2026-09-29T02:00:00Z'),
    ]);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /RED ci failure at deadbee/);
    // a red run with a newer run pending that does not declare itself its fix stays red (M18.118, cp12 F2)
    const hidden = lastCi([
      run('ci', 'in_progress', '2026-09-29T03:00:00Z', { headSha: 'abc', message: 'M1.1: feat(x): y' }),
      run('ci', 'failure', '2026-09-29T02:00:00Z'),
    ]);
    assert.equal(hidden.status, 1, hidden.out);
    assert.match(hidden.out, /1 newer run pending\): none declares Fixes-ci: 20/);
    // one workflow red with nothing pending still blocks outright, whatever the other waits for
    const both = lastCi([
      run('ci', 'in_progress', '2026-09-29T03:00:00Z'),
      run('ci', 'failure', '2026-09-29T02:00:00Z'),
      run('gates', 'failure', '2026-09-29T02:00:00Z'),
    ]);
    assert.equal(both.status, 1, both.out);
    // a pending run older than the red one cannot hold its fix: red, not wait
    const older = lastCi([run('ci', 'failure', '2026-09-29T03:00:00Z'), run('ci', 'in_progress', '2026-09-29T02:00:00Z')]);
    assert.equal(older.status, 1, older.out);
    assert.doesNotMatch(older.out, /pending/);
    // a cancelled or timed-out run is not green either
    assert.equal(lastCi([run('gates', 'cancelled', '2026-09-29T02:00:00Z')]).status, 1);
  });

  it('a green or pending last run lets the task start', () => {
    const green = lastCi([
      run('ci', 'success', '2026-09-29T02:00:00Z'),
      run('ci', 'failure', '2026-09-29T01:00:00Z'),
      run('gates', 'success', '2026-09-29T02:00:00Z'),
    ]);
    assert.equal(green.status, 0, green.out);
    assert.match(green.out, /ci green at abcdef1/);
    // only pending runs, or none at all: nothing to fix yet
    assert.equal(lastCi([run('ci', 'queued', '2026-09-29T02:00:00Z')]).status, 0);
    assert.equal(lastCi([]).status, 0);
  });

  it("NFR-MNT-005: the nightly's latest completed run is reported, red or green, and never blocks the task (M18.124)", () => {
    const green = [run('ci', 'success', '2026-09-29T02:00:00Z'), run('gates', 'success', '2026-09-29T02:00:00Z')];
    const red = lastCi([...green, run('nightly', 'in_progress', '2026-09-29T04:00:00Z'), run('nightly', 'failure', '2026-09-29T03:00:00Z', 'feedbee0000000')]);
    assert.equal(red.status, 0, red.out);
    assert.match(red.out, /last-ci: nightly RED failure at feedbee \(run 20\); not a verdict/);
    const ok = lastCi([...green, run('nightly', 'failure', '2026-09-28T03:00:00Z'), run('nightly', 'success', '2026-09-29T03:00:00Z', 'c0ffee00000000')]);
    assert.match(ok.out, /last-ci: nightly green at c0ffee0/);
    assert.match(lastCi(green).out, /last-ci: nightly has no completed run on main; not a verdict/);
    // a red workflow still decides the exit; the nightly line changes nothing
    assert.equal(lastCi([run('ci', 'failure', '2026-09-29T02:00:00Z'), run('nightly', 'success', '2026-09-29T03:00:00Z')]).status, 1);
  });

  it('M18.118: only a pending run whose commit declares Fixes-ci for the red run is waited for, and only within bounds', () => {
    const red = run('ci', 'failure', '2026-09-29T02:00:00Z', { headSha: 'deadbee0000000', databaseId: 41 });
    const pending = (at, message, id) => run('ci', 'in_progress', at, { headSha: 'abc', message, databaseId: id });
    const fix = pending('2026-09-29T03:00:00Z', 'M1.2: fix(ci): z\n\nFixes-ci: 40, 41\n', 42);
    const waited = lastCi([fix, red]);
    assert.equal(waited.status, 2, waited.out);
    assert.match(waited.out, /wait for the declared fix \(run 42\)/);
    // a trailer naming another run is no declaration for this one
    assert.equal(lastCi([pending('2026-09-29T03:00:00Z', 'Fixes-ci: 4100', 42), red]).status, 1);
    // ordinary commits landing after the fix: waited through up to LAST_CI_MAX_PENDING, then red
    const later = (n) => Array.from({ length: n }, (_, i) => pending(`2026-09-29T03:1${i}:00Z`, 'M1.3: feat(x): w', 50 + i));
    assert.equal(lastCi([...later(3).reverse(), fix, red]).status, 2);
    const crowded = lastCi([...later(4).reverse(), fix, red]);
    assert.equal(crowded.status, 1, crowded.out);
    assert.match(crowded.out, /more than 4 runs pending on one red/);
    // a declared fix pending past LAST_CI_MAX_WAIT_MS (120 min) no longer holds the red
    const stale = lastCi([fix, red], '2026-09-29T05:00:01Z');
    assert.equal(stale.status, 1, stale.out);
    assert.match(stale.out, /pending over 120 min/);
    assert.equal(lastCi([fix, red], '2026-09-29T05:00:00Z').status, 2);
    // without a message field the commit message comes from the local clone; an unknown sha has none
    assert.equal(lastCi([run('ci', 'in_progress', '2026-09-29T03:00:00Z', { headSha: '0'.repeat(40), databaseId: 42 }), red]).status, 1);
  });

  it('M18.118 r1 F1: the trailer is read from REST head_commit, else from the local clone', async () => {
    const { restSource } = await import('../../scripts/gates/ci-runs.mjs');
    const body = {
      workflow_runs: [
        { id: 7, name: 'ci', head_sha: 'f'.repeat(40), status: 'queued', conclusion: null, created_at: 'x', head_commit: { message: 'Fixes-ci: 6' } },
      ],
    };
    const rest = restSource({ fetch: async () => ({ ok: true, json: async () => body }) });
    assert.equal((await rest.branch('main'))[0].message, 'Fixes-ci: 6');
    const dir = mkdtempSync(join(tmpdir(), 'last-ci-clone-'));
    try {
      // a hook's GIT_DIR/GIT_INDEX_FILE would aim these at the repo being committed (M18.138)
      const g = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: cleanEnv() });
      g('init', '-q');
      g('-c', 'user.name=t', '-c', 'user.email=t@e', 'commit', '-q', '--allow-empty', '-m', 'M1.4: fix(ci): v', '-m', 'Fixes-ci: 41');
      const sha = g('rev-parse', 'HEAD').stdout.trim();
      const red = run('ci', 'failure', '2026-09-29T02:00:00Z', { headSha: 'deadbee0000000', databaseId: 41 });
      const fix = run('ci', 'in_progress', '2026-09-29T03:00:00Z', { headSha: sha, databaseId: 42 });
      assert.equal(lastCi([fix, red], undefined, dir).status, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("M18.138: run under a commit hook's git environment, the clone test leaves the hook's repository alone", () => {
    const decoy = mkdtempSync(join(tmpdir(), 'last-ci-decoy-'));
    try {
      const g = (...args) => spawnSync('git', args, { cwd: decoy, encoding: 'utf8', env: cleanEnv() });
      g('init', '-q');
      g('-c', 'user.name=t', '-c', 'user.email=t@e', 'commit', '-q', '--allow-empty', '-m', 'decoy');
      const before = g('rev-parse', 'HEAD').stdout.trim();
      // what pre-commit exports to its children
      const env = { ...process.env, GIT_DIR: join(decoy, '.git'), GIT_INDEX_FILE: join(decoy, '.git', 'index'), GIT_WORK_TREE: decoy };
      delete env.NODE_TEST_CONTEXT; // a nested runner reports to this one otherwise, printing nothing
      const r = spawnSync(process.execPath, ['--test', '--test-name-pattern', 'M18.118 r1 F1', join(REPO, 'tests/harness/last-ci.test.mjs')], {
        encoding: 'utf8',
        env,
      });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, /# pass 1/);
      assert.equal(g('rev-parse', 'HEAD').stdout.trim(), before);
    } finally {
      rmSync(decoy, { recursive: true, force: true });
    }
  });
});
