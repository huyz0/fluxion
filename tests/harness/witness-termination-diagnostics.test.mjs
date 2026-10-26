import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import { cleanupSummary, traceTermination } from '../../packages/cli/src/e2e/fixtures/witness-diagnostics.mjs';
import { failureLines } from '../../scripts/gates/failure-report.mjs';

test('HARNESS: termination diagnostics drain bounded helper output and preserve nonzero exit independently of browser exit', async () => {
  const trace = {};
  const options = { shell: false, windowsHide: true, stdio: 'ignore', timeout: 2000 };
  const child = traceTermination(
    spawn,
    {
      file: process.execPath,
      args: ['-e', "process.stdout.write('OUTPUT'+'x'.repeat(100000));process.stderr.write('DENIED'+'y'.repeat(100000));process.exitCode=7"],
      options,
    },
    trace,
  );
  await once(child, 'close');
  assert.equal(trace.code, 7);
  assert.equal(trace.signal, null);
  assert.equal(trace.stdout.length, 4096);
  assert.equal(trace.stderr.length, 4096);
  assert.equal(trace.stdoutTruncated, true);
  assert.equal(trace.stderrTruncated, true);
  assert.ok(trace.stderr.startsWith('DENIED'));
  assert.equal(options.stdio, 'ignore');
  assert.equal(trace.file, process.execPath);
});
test('HARNESS: spawn error and signal are retained without rewriting process outcomes', async () => {
  const trace = {};
  const child = traceTermination(spawn, { file: 'fluxion-no-such-diagnostic-executable', args: [], options: { shell: false } }, trace);
  await new Promise((resolve) => child.once('close', resolve));
  assert.equal(trace.error.code, 'ENOENT');
  const signalled = {};
  const helper = traceTermination(spawn, { file: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], options: {} }, signalled);
  const closed = new Promise((resolve) => helper.once('close', resolve));
  helper.kill();
  await closed;
  assert.equal(signalled.signal, 'SIGTERM');
});
test('HARNESS: deliberate native-style failure exposes helper denial and primary actual/expected through TAP annotations', () => {
  const record = {
    child: { exitCode: null, signalCode: null },
    termination: { code: 7, signal: null, stderr: `ACCESS_DENIED${'z'.repeat(4096)}`, stdout: '' },
  };
  const summary = cleanupSummary(record, { code: 'ERR_ASSERTION', actual: 'cleanup', expected: 'cancelled', message: 'PRIMARY_FAILURE' });
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import test from 'node:test';import assert from 'node:assert/strict';test('native failure',()=>assert.equal(false,true,${JSON.stringify(summary)}));`,
    ],
    { encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: '' } },
  );
  assert.notEqual(result.status, 0);
  const details = failureLines(result.stdout, result.stderr).join('\n');
  for (const needle of ['ACCESS_DENIED', 'cleanup', 'cancelled', 'ERR_ASSERTION', 'PRIMARY_FAILURE']) assert.ok(details.includes(needle), details);
  assert.ok(summary.length < 700);
});

test('HARNESS: successful helper completion does not invent owned browser exit', async () => {
  const trace = {};
  const child = traceTermination(spawn, { file: process.execPath, args: ['-e', 'process.exitCode=0'], options: {} }, trace);
  await once(child, 'close');
  const summary = JSON.parse(cleanupSummary({ child: { exitCode: null, signalCode: null }, termination: trace }));
  assert.equal(summary.helper.code, 0);
  assert.equal(summary.browser.exitCode, null);
  assert.equal(summary.browser.signalCode, null);
});
