import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, watch, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock, test } from 'node:test';
import { runAsync } from '../../scripts/gates/lib.mjs';
import { withLiveStepLog } from '../../scripts/gates/live-step-log.mjs';

test('NFR-DX-003: concurrent live step streams retain exact text and original failure status', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fluxion-live-log-'));
  try {
    const results = await Promise.all(
      ['first', 'second'].map((name) =>
        withLiveStepLog(dir, name, () =>
          runAsync(process.execPath, ['-e', `process.stdout.write('${name} α');process.stderr.write('${name} failure');process.exitCode=7`]),
        ),
      ),
    );
    for (const [index, name] of ['first', 'second'].entries()) {
      assert.equal(results[index].status, 7);
      assert.equal(readFileSync(join(dir, `${name}.stdout.partial.log`), 'utf8'), `${name} α`);
      assert.equal(readFileSync(join(dir, `${name}.stderr.partial.log`), 'utf8'), `${name} failure`);
      assert.equal(results[index].stdout, `${name} α`);
      assert.equal(results[index].stderr, `${name} failure`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('NFR-DX-003: emitted diagnostics survive interruption before the supervised check completes', { timeout: 15000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'fluxion-interrupted-log-'));
  const file = join(dir, 'interrupted.stderr.partial.log');
  const watcher = watch(dir);
  let supervisor;
  try {
    const ready = new Promise((resolve, reject) => {
      t.signal.addEventListener('abort', () => reject(t.signal.reason), { once: true });
      watcher.on('change', () => {
        try {
          if (readFileSync(file, 'utf8').includes('FAIL before interruption')) resolve();
        } catch {
          /* file not created yet */
        }
      });
    });
    const code = `import {withLiveStepLog} from ${JSON.stringify(new URL('../../scripts/gates/live-step-log.mjs', import.meta.url).href)};
      import {runAsync} from ${JSON.stringify(new URL('../../scripts/gates/lib.mjs', import.meta.url).href)};
      await withLiveStepLog(${JSON.stringify(dir)},'interrupted',()=>runAsync(process.execPath,['-e',"process.stderr.write('FAIL before interruption');process.stdin.resume();process.stdin.on('end',()=>process.exit(7));"]));`;
    supervisor = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: 'ignore' });
    await Promise.race([
      ready,
      once(supervisor, 'exit').then(() => {
        throw Error('supervisor exited before its diagnostic was persisted');
      }),
    ]);
    assert.equal(supervisor.exitCode, null, 'the failing child has not completed');
    const exited = once(supervisor, 'exit');
    supervisor.kill();
    await exited;
    assert.equal(readFileSync(file, 'utf8'), 'FAIL before interruption');
  } finally {
    watcher.close();
    supervisor?.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('NFR-DX-003: unavailable log storage warns without hiding the original failure', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fluxion-log-unavailable-'));
  const warning = mock.method(console, 'warn', () => {});
  try {
    const file = join(dir, 'not-a-directory');
    writeFileSync(file, 'occupied');
    const result = await withLiveStepLog(file, 'failed', () =>
      runAsync(process.execPath, ['-e', "process.stderr.write('actual assertion');process.exitCode=9"]),
    );
    assert.equal(result.status, 9);
    assert.equal(result.stderr, 'actual assertion');
    assert.equal(warning.mock.callCount(), 1);
  } finally {
    warning.mock.restore();
    rmSync(dir, { recursive: true, force: true });
  }
});
