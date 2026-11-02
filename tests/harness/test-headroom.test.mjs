// HARNESS NFR-DX-004: bounded-time unit tests are measured on every OS before they redden main (M18.222, cp32 F1).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { testStepEnv } from '../../scripts/gates/lib.mjs';
import { headroom, persistent, previousRun } from '../../scripts/harness/test-headroom.mjs';
import { reading } from '../../tools/vitest/durations-reporter.mjs';

const t = (name, durationMs, timeoutMs = 10_000) => ({ module: 'packages/x/src/a.test.ts', name, project: 'node', durationMs, timeoutMs });

describe('test headroom (M18.222)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'headroom-'));
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('lists a test by its slowest OS, over half its timeout, slowest first', () => {
    const listed = headroom([
      { platform: 'linux', tests: [t('bounded', 1_000), t('tight', 4_000, 5_000), t('fast', 10)] },
      { platform: 'darwin', tests: [t('bounded', 6_000), t('fast', 20)] },
      { platform: 'win32', tests: [t('bounded', 3_000), t('tight', 3_000, 5_000)] },
    ]);
    assert.deepEqual(
      listed.map((x) => [x.name, x.worst.platform, x.worst.durationMs]),
      [
        ['tight', 'linux', 4_000],
        ['bounded', 'darwin', 6_000],
      ],
    );
  });

  it('keeps a test at exactly half, and one with no timeout, off the list', () => {
    assert.deepEqual(headroom([{ platform: 'linux', tests: [t('half', 5_000), t('none', 9_000, 0)] }]), []);
    assert.equal(headroom([{ platform: 'linux', tests: [t('quarter', 2_600)] }], 0.25).length, 1);
  });

  it('records a reading with a repo-relative module path and the timeout the test ran under', () => {
    const r = reading({
      moduleId: join(process.cwd(), 'packages', 'x', 'src', 'a.test.ts'),
      fullName: 's > n',
      project: 'node',
      durationMs: 12.6,
      timeoutMs: 20_000,
    });
    assert.deepEqual(r, { module: 'packages/x/src/a.test.ts', name: 's > n', project: 'node', durationMs: 13, timeoutMs: 20_000 });
  });

  it('leaves the durations file to the root Vitest run: test steps do not inherit it', () => {
    assert.deepEqual(testStepEnv({ FLUXION_TEST_DURATIONS: 'd.json', GIT_DIR: '.git', PATH: '/bin' }), { PATH: '/bin' });
  });

  it('exits 1 naming the test and its OS, 0 when every test has headroom, 2 with no report', () => {
    const slow = join(dir, 'darwin.json');
    writeFileSync(slow, JSON.stringify({ platform: 'darwin', tests: [t('bounded', 6_000)] }));
    const ok = join(dir, 'linux.json');
    writeFileSync(ok, JSON.stringify({ platform: 'linux', tests: [t('bounded', 600)] }));
    const run = (...a) => spawnSync(process.execPath, ['scripts/harness/test-headroom.mjs', ...a], { encoding: 'utf8' });
    const listed = run('--file', ok, '--file', slow);
    assert.equal(listed.status, 1, listed.stderr);
    assert.match(listed.stdout, /a\.test\.ts > bounded: 6000 ms of 10000 ms \(60%\) on darwin/);
    assert.equal(run('--file', ok).status, 0);
    assert.equal(run().status, 2);
  });

  it('fails only on a test over half its timeout in this run and the run before; an empty report is unreadable (M18.224)', () => {
    const now = [{ platform: 'linux', tests: [t('steady', 6_000), t('blip', 6_000), t('fast', 100)] }];
    const before = [{ platform: 'linux', tests: [t('steady', 7_000), t('blip', 1_000), t('fast', 9_000)] }];
    assert.deepEqual(
      persistent(headroom(now), before, 0.5).map((x) => x.name),
      ['steady'],
    );
    const write = (name, tests) => {
      const f = join(dir, name);
      writeFileSync(f, JSON.stringify({ platform: 'linux', tests }));
      return f;
    };
    const run = (...a) => spawnSync(process.execPath, ['scripts/harness/test-headroom.mjs', ...a], { encoding: 'utf8' });
    const cur = write('now.json', now[0].tests);
    const twice = run('--file', cur, '--previous', write('before.json', before[0].tests));
    assert.equal(twice.status, 1, twice.stderr);
    assert.match(twice.stdout, /over in two consecutive runs: packages\/x\/src\/a\.test\.ts > steady/);
    assert.doesNotMatch(twice.stdout, /consecutive runs: .*blip/);
    assert.equal(run('--file', cur, '--previous', write('calm.json', [t('steady', 100)])).status, 0);
    // CI's path with no previous report: it lists and warns, and only a report with no readings fails
    const warned = run('--file', cur, '--warn-only');
    assert.equal(warned.status, 0, warned.stderr);
    assert.match(warned.stdout, /steady: 6000 ms of 10000 ms/);
    assert.equal(run('--file', write('empty-warned.json', []), '--warn-only').status, 2);
    const empty = run('--file', write('empty.json', []));
    assert.equal(empty.status, 2);
    assert.match(empty.stderr, /no readings/);
    const unreadable = run('--file', cur, '--previous', write('empty-before.json', []));
    assert.equal(unreadable.status, 0, unreadable.stderr);
    assert.match(unreadable.stderr, /previous report ignored/);
  });
  it('compares with the newest completed run whose verify on this OS finished, skipping a cancelled one and its own (M18.232)', async () => {
    const verify = (os, conclusion) => [
      { name: 'verify (ubuntu-latest)', conclusion: 'success' },
      { name: `verify (${os})`, conclusion },
    ];
    // newest first: a cancelled run, this run's own earlier attempt, then a red and a green one
    const runs = [
      { databaseId: 9, jobs: verify('macos-latest', 'cancelled') },
      { databaseId: 8, jobs: verify('macos-latest', 'success') },
      { databaseId: 7, jobs: verify('macos-latest', 'failure') },
      { databaseId: 6, jobs: verify('macos-latest', 'success') },
    ];
    const jobsOf = (id) => runs.find((r) => String(r.databaseId) === id)?.jobs ?? null;
    assert.deepEqual(await previousRun(runs, jobsOf, { os: 'macos-latest', exclude: '8' }), { run: '7', conclusion: 'failure' });
    assert.deepEqual(await previousRun(runs, jobsOf, { os: 'macos-latest' }), { run: '8', conclusion: 'success' });
    assert.equal(await previousRun(runs.slice(0, 1), jobsOf, { os: 'macos-latest' }), undefined);
    assert.equal(await previousRun(runs, () => null, { os: 'macos-latest' }), undefined, 'unreadable jobs give no baseline');
    // the CLI prints the id on stdout (the CI step's baseline, so it does not fall back to --warn-only) and names it on stderr
    const file = join(dir, 'runs.json');
    writeFileSync(file, JSON.stringify(runs));
    const pick = (...a) =>
      spawnSync(process.execPath, ['scripts/harness/test-headroom.mjs', '--pick-previous', '--runs-file', file, ...a], { encoding: 'utf8' });
    const picked = pick('--os', 'macos-latest', '--exclude', '8');
    assert.equal(picked.status, 0, picked.stderr);
    assert.equal(picked.stdout.trim(), '7');
    assert.match(picked.stderr, /comparing with run 7, whose verify \(macos-latest\) concluded failure/);
    const none = pick('--os', 'windows-latest');
    assert.equal(none.status, 0, none.stderr);
    assert.equal(none.stdout, '');
    assert.match(none.stderr, /no completed main run .* verify \(windows-latest\)/);
    assert.equal(pick().status, 2, 'no --os');
  });
});
