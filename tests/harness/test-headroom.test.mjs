// HARNESS NFR-DX-004: bounded-time unit tests are measured on every OS before they redden main (M18.222, cp32 F1).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { testStepEnv } from '../../scripts/gates/lib.mjs';
import { headroom } from '../../scripts/harness/test-headroom.mjs';
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
});
