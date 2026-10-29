// M5.2 (M4 final F3, NFR-DX-003): the loop reads main's last CI before a task.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { cleanEnv, REPO } from './helpers.mjs';

/** Runs last-ci.mjs against `runs` (gh run list shape); returns its status and output. */
function lastCi(runs, now = '2026-09-29T03:30:00Z', cwd = undefined, backlog = undefined) {
  const dir = mkdtempSync(join(tmpdir(), 'last-ci-'));
  try {
    const file = join(dir, 'runs.json');
    writeFileSync(file, JSON.stringify(runs));
    // a backlog of the test's own, or none: the live backlog's rows must not change what a test sees
    const backlogFile = join(dir, 'backlog.md');
    writeFileSync(backlogFile, backlog ?? '');
    const r = spawnSync(
      process.execPath,
      [join(REPO, 'scripts/harness/last-ci.mjs'), '--runs-file', file, '--now', now, '--offline', '--backlog', backlogFile],
      {
        encoding: 'utf8',
        cwd,
        env: cleanEnv(),
      },
    );
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
  it("NFR-DX-001: reports ci's cold-setup job; only a failure by status blocks (M18.161)", () => {
    const at = (coldSetup) => lastCi([run('ci', 'success', '2026-09-29T02:00:00Z', { coldSetup }), run('gates', 'success', '2026-09-29T02:00:00Z')]);
    const log = (line) => `2026-09-29T02:10:00Z budget: cold phase verify 1 ms\n2026-09-29T02:10:00Z budget: ${line}\n`;
    const status = at({ conclusion: 'failure', log: log('cold setup failed by status in phase verify:test after 517002 ms') });
    assert.equal(status.status, 1, status.out);
    assert.match(status.out, /RED cold-setup at abcdef1 \(run 20\): cold setup failed by status in phase verify:test after 517002 ms/);
    const time = at({ conclusion: 'failure', log: log('cold setup failed by time (660902 ms > 600000 ms); slowest phase verify:test 604230 ms') });
    assert.equal(time.status, 0, time.out);
    assert.match(time.out, /warning: cold-setup at abcdef1 \(run 20\): cold setup failed by time \(660902 ms > 600000 ms\)/);
    const unreadable = at({ conclusion: 'failure', log: null });
    assert.equal(unreadable.status, 0, unreadable.out);
    assert.match(unreadable.out, /cold-setup failure at abcdef1 \(run 20\); cause UNKNOWN \(log unreadable\)/);
    // a newer ci run pending does not hide it: the newest *completed* run's cold-setup is read (r1 F1)
    const behind = lastCi([
      run('ci', 'in_progress', '2026-09-29T03:00:00Z', { databaseId: 21, headSha: 'fff', message: 'M1.1: feat(x): y' }),
      run('ci', 'success', '2026-09-29T02:00:00Z', {
        coldSetup: { conclusion: 'failure', log: log('cold setup failed by status in phase install after 1 ms') },
      }),
      run('gates', 'success', '2026-09-29T02:00:00Z'),
    ]);
    assert.equal(behind.status, 1, behind.out);
    assert.match(behind.out, /RED cold-setup .*run 20.*none declares Fixes-ci: 20.*failed by status in phase install/);
    // unless that newer run declares itself the fix: then wait, as for the run's own red (r1 F3)
    const fixing = lastCi([
      run('ci', 'in_progress', '2026-09-29T03:00:00Z', { databaseId: 21, headSha: 'fff', message: 'M1.1: fix(x): y\n\nFixes-ci: 20' }),
      run('ci', 'success', '2026-09-29T02:00:00Z', {
        coldSetup: { conclusion: 'failure', log: log('cold setup failed by status in phase install after 1 ms') },
      }),
      run('gates', 'success', '2026-09-29T02:00:00Z'),
    ]);
    assert.equal(fixing.status, 2, fixing.out);
    // a query that throws is unknown, never green (r1 F2)
    const thrown = at('throws');
    assert.equal(thrown.status, 0, thrown.out);
    assert.match(thrown.out, /cold-setup UNKNOWN at abcdef1 \(run 20\): its job could not be read/);
    assert.doesNotMatch(thrown.out, /cold-setup green/);
    const green = at({ conclusion: 'success', ms: 565_000, log: null });
    assert.equal(green.status, 0, green.out);
    assert.match(green.out, /cold-setup green at abcdef1 \(run 20\) \(565 s\)/);
  });

  it('NFR-DX-001: a cold-setup that succeeds only under the by-time exemption is over budget, never green (M18.164)', () => {
    const at = (coldSetup) => lastCi([run('ci', 'success', '2026-09-29T02:00:00Z', { coldSetup }), run('gates', 'success', '2026-09-29T02:00:00Z')]);
    const warning = '2026-09-29T02:10:00Z ::warning title=cold setup over budget::cold setup 669120 ms > 600000 ms, exempt while M18.157 is open\n';
    // from the step timing alone, the log unreadable
    const timed = at({ conclusion: 'success', ms: 664_000, log: null });
    assert.equal(timed.status, 0, timed.out);
    assert.match(timed.out, /warning: cold-setup over budget at abcdef1 \(run 20\): 664 s > 600 s \(exempt while M18\.157 is open\)/);
    assert.doesNotMatch(timed.out, /cold-setup green|continue-on-error/);
    // from the ::warning annotation alone, no step time
    const annotated = at({ conclusion: 'success', ms: null, log: warning });
    assert.match(annotated.out, /warning: cold-setup over budget at abcdef1 \(run 20\): 669 s > 600 s/);
    assert.doesNotMatch(annotated.out, /cold-setup green/);
    // neither known: unknown, never green
    const blind = at({ conclusion: 'success', ms: null, log: null });
    assert.match(blind.out, /cold-setup success at abcdef1 \(run 20\); duration UNKNOWN/);
    assert.doesNotMatch(blind.out, /cold-setup green/);
    // a readable log with neither a budget line nor a step time is unknown, not green (M18.178)
    const silent = at({ conclusion: 'success', ms: null, log: 'budget: cold phase verify 1 ms\n' });
    assert.match(silent.out, /cold-setup success at abcdef1 \(run 20\); duration UNKNOWN \(no step time, no budget line in the log\)/);
    assert.doesNotMatch(silent.out, /cold-setup green/);
  });

  it('NFR-DX-001: a cold-setup is green only on a known in-budget duration, the warning read in both log forms (M18.178, cp23 F2)', () => {
    const at = (coldSetup) => lastCi([run('ci', 'success', '2026-09-29T02:00:00Z', { coldSetup }), run('gates', 'success', '2026-09-29T02:00:00Z')]);
    // GitHub's downloaded log writes the annotation as ##[warning]
    const downloaded = at({
      conclusion: 'success',
      ms: null,
      log: '2026-09-29T02:10:00.1Z ##[warning]cold setup 664000 ms > 600000 ms, exempt while M18.157 is open\n',
    });
    assert.match(downloaded.out, /warning: cold-setup over budget at abcdef1 \(run 20\): 664 s > 600 s/);
    assert.doesNotMatch(downloaded.out, /cold-setup green/);
    // the blame line alone is an overrun too
    const blamed = at({ conclusion: 'success', ms: null, log: 'budget: cold setup failed by time (661000 ms > 600000 ms); slowest phase verify:test 1 ms\n' });
    assert.match(blamed.out, /over budget .*: 661 s > 600 s/);
    // check-budget's own within-budget line is a known duration, and wins over the step's start-up
    const within = at({ conclusion: 'success', ms: 601_500, log: 'budget: cold setup 598000 ms <= 600000 ms (empty store: …)\n' });
    assert.match(within.out, /cold-setup green at abcdef1 \(run 20\) \(598 s\)/);
    // a readable log without a budget line: the step time alone decides
    assert.match(at({ conclusion: 'success', ms: 540_000, log: 'budget: cold phase verify 1 ms\n' }).out, /cold-setup green at abcdef1 \(run 20\) \(540 s\)/);
    // no source at all: unknown
    assert.match(at({ conclusion: 'success', ms: null, log: '' }).out, /duration UNKNOWN/);
  });

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
    // an unreadable nightly is said and changes no verdict (M18.137)
    const unread = lastCi([...green, run('nightly', 'success', '2026-09-29T03:00:00Z', { queryFails: true })]);
    assert.equal(unread.status, 0, unread.out);
    assert.match(unread.out, /last-ci: cannot read main's nightly runs \(query failed\); not a verdict/);
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

  it('M18.134: a red run that fell out of the listing window still blocks, and many pending runs with no completed one are unknown, not green', () => {
    const pending = Array.from({ length: 10 }, (_, i) =>
      run('ci', 'queued', `2026-09-29T03:${String(10 + i)}:00Z`, { databaseId: 60 + i, message: 'M1.3: feat(x): w' }),
    );
    const gates = run('gates', 'success', '2026-09-29T02:30:00Z');
    // only the status-filtered query sees the old red run (cp14 F1: release and gates runs filled the window)
    const hidden = run('ci', 'failure', '2026-09-29T01:00:00Z', { headSha: 'deadbee0000000', databaseId: 41, outsideWindow: true });
    const red = lastCi([...pending, gates, hidden]);
    assert.equal(red.status, 1, red.out);
    assert.match(red.out, /RED ci failure at deadbee \(run 41\) \(10 newer runs pending\)/);
    // nothing completed anywhere: more than LAST_CI_MAX_PENDING (4) pending runs are unknown, at most 4 are not yet a verdict
    const unknown = lastCi([...pending, gates]);
    assert.equal(unknown.status, 3, unknown.out);
    assert.match(unknown.out, /UNKNOWN ci: no completed run found behind 10 pending runs/);
    assert.equal(lastCi([...pending.slice(0, 4), gates]).status, 0);
    assert.equal(lastCi([...pending.slice(0, 5), gates]).status, 3);
    // a failed status query is said, and with no completed run in the window the state is unknown (r1 F2)
    const unread = lastCi([pending[0], gates, hidden, { workflowName: 'ci', queryFails: true }]);
    assert.equal(unread.status, 3, unread.out);
    assert.match(unread.out, /cannot read ci's newest completed run \(query failed\)[\s\S]*UNKNOWN ci/);
  });

  it('M18.128: every unknown state exits 3, red outranks it and it outranks a wait; an unreadable branch is unknown, not green', () => {
    const pending = Array.from({ length: 5 }, (_, i) => run('ci', 'queued', `2026-09-29T03:1${i}:00Z`, { databaseId: 70 + i, message: 'M1.3: feat(x): w' }));
    const redGates = run('gates', 'failure', '2026-09-29T02:00:00Z');
    assert.equal(lastCi([...pending, redGates]).status, 1, 'red gates outranks unknown ci');
    const red = run('gates', 'failure', '2026-09-29T02:00:00Z', { databaseId: 41 });
    const fix = run('gates', 'in_progress', '2026-09-29T03:00:00Z', { headSha: 'abc', message: 'M1.2: fix(ci): z\n\nFixes-ci: 41\n', databaseId: 42 });
    assert.equal(lastCi([...pending, fix, red]).status, 3, 'unknown ci outranks a gates wait');
    assert.equal(lastCi([fix, red]).status, 2);
    // the run source itself cannot be read: a runs file that is not JSON stands in for no answer from GitHub
    const dir = mkdtempSync(join(tmpdir(), 'last-ci-bad-'));
    try {
      writeFileSync(join(dir, 'runs.json'), 'not json');
      const r = spawnSync(process.execPath, [join(REPO, 'scripts/harness/last-ci.mjs'), '--runs-file', join(dir, 'runs.json'), '--offline'], {
        encoding: 'utf8',
        env: cleanEnv(),
      });
      assert.equal(r.status, 3, r.stdout + r.stderr);
      assert.match(r.stdout, /UNKNOWN cannot read main's runs/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('M18.191: a failed job in a pending run is red at that run, and a green behind too many pending runs is unknown (cp24 F1)', () => {
    const green = run('ci', 'success', '2026-09-29T01:00:00Z', { databaseId: 40 });
    const gates = run('gates', 'success', '2026-09-29T01:00:00Z', { databaseId: 39 });
    const pendingRun = (i, jobs, message = 'M1.3: feat(x): w') =>
      run('ci', 'in_progress', `2026-09-29T02:${String(10 + i)}:00Z`, { databaseId: 50 + i, headSha: `beef${i}000000`, message, jobs });
    const windowsRed = [
      { name: 'verify (ubuntu-latest)', conclusion: null },
      { name: 'verify (windows-latest)', conclusion: 'failure' },
    ];
    // a windows verify job failed while its run is still in progress: red at that run, not the older green
    let r = lastCi([pendingRun(0, windowsRed), green, gates]);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /RED ci failure in verify \(windows-latest\) \(run still pending\) at beef000 \(run 50\): fix main's CI/);
    // a newer run that does not declare a fix for it does not hide it; one that does is waited for
    r = lastCi([pendingRun(1, []), pendingRun(0, windowsRed), green, gates]);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /none declares Fixes-ci: 50/);
    r = lastCi([pendingRun(1, [], 'M1.4: fix(ci): z\n\nFixes-ci: 50\n'), pendingRun(0, windowsRed), green, gates]);
    assert.equal(r.status, 2, r.out);
    assert.match(r.out, /wait for the declared fix \(run 51\)/);
    // cancelled, queued and unfinished jobs are no failure: the older verdict stands
    const quiet = [
      { name: 'verify (windows-latest)', conclusion: 'cancelled' },
      { name: 'e2e', conclusion: null },
      { name: 'cli-mcp', conclusion: 'skipped' },
    ];
    r = lastCi([pendingRun(0, quiet), green, gates]);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /ci green at abcdef1 \(run 40\) \(1 newer run pending\)/);
    // a timed-out job is a failure too
    r = lastCi([pendingRun(0, [{ name: 'e2e (webkit)', conclusion: 'timed_out' }]), green, gates]);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /RED ci failure in e2e \(webkit\) timed_out \(run still pending\)/);
    // jobs that cannot be read are unknown, not green
    r = lastCi([pendingRun(0, 'throws'), green, gates]);
    assert.equal(r.status, 3, r.out);
    assert.match(r.out, /UNKNOWN ci: the jobs of pending run 50 at beef000 could not be read/);
    // five pending runs behind a completed green are unknown; four are not yet a verdict
    const five = Array.from({ length: 5 }, (_, i) => pendingRun(i, []));
    r = lastCi([...five, green, gates]);
    assert.equal(r.status, 3, r.out);
    assert.match(r.out, /UNKNOWN ci: green at abcdef1 \(run 40\) is behind 5 pending runs, more than 4/);
    assert.equal(lastCi([...five.slice(0, 4), green, gates]).status, 0);
    // red outranks that unknown
    assert.equal(lastCi([...five.slice(1), pendingRun(0, windowsRed), green, gates]).status, 1);
  });

  it('a red run names an open blocks-landing row, under which that row and harness-path commits proceed (M18.142)', () => {
    const row = (state) => `| M18.117 | CI green \`blocks-landing\` | HARNESS | acceptance | — | ${state} | |\n`;
    const red = [run('ci', 'failure', '2026-09-29T02:00:00Z', 'deadbee0000000'), run('gates', 'success', '2026-09-29T02:00:00Z')];
    const named = /last-ci: M18\.117 blocks landing \(`blocks-landing`\): only that row and commits confined to HARNESS_PATHS proceed until it is done/;
    let r = lastCi(red, undefined, undefined, row('todo'));
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, named);
    r = lastCi(red, undefined, undefined, row('done'));
    assert.equal(r.status, 1, r.out);
    assert.doesNotMatch(r.out, /blocks landing/, 'a done row blocks nothing');
    r = lastCi([run('ci', 'success', '2026-09-29T02:00:00Z'), run('gates', 'success', '2026-09-29T02:00:00Z')], undefined, undefined, row('todo'));
    assert.equal(r.status, 0, r.out);
    assert.doesNotMatch(r.out, /blocks landing/, 'only a red verdict names it');
  });
});
