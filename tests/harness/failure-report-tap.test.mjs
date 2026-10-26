import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { failureAnnotation, failureLines } from '../../scripts/gates/failure-report.mjs';

test('HARNESS: nested TAP assertions retain each failure instead of only a passing tail', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fluxion-tap-failures-'));
  try {
    const file = join(directory, 'probe.test.mjs');
    writeFileSync(
      file,
      "import assert from 'node:assert/strict'; import {test} from 'node:test'; for(let i=0;i<4;i++)test('owned-browser-failure-'+i,()=>assert.equal(false,true));test('delimiter-content',()=>{throw Error('...details unavailable\\nreason')});",
    );
    const failed = spawnSync(process.execPath, ['--test', '--test-reporter=tap', file], {
      encoding: 'utf8',
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT')),
    });
    assert.equal(failed.status, 1, failed.stderr);
    const stdout = ` FAIL node outer.test.ts\nAssertionError: ${failed.stdout}\n${'outer successful tail\n'.repeat(60)}`;
    const details = failureLines(stdout, failed.stderr);
    const text = details.join('\n');
    for (let i = 0; i < 4; i++) assert.match(text, new RegExp(`not ok .*owned-browser-failure-${i}`));
    for (const field of ['location:', 'error:', 'expected: true', 'actual: false', 'stack:']) assert.ok(text.includes(field), field);
    assert.ok(text.includes('...details unavailable'));
    assert.ok(text.includes('reason'));
    const annotation = failureAnnotation('test', details, 'full.log');
    assert.ok(annotation.includes('owned-browser-failure-3'));
    assert.ok(annotation.includes('Full failure output: full.log'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('HARNESS: a large nested TAP field cannot hide the next failing subtest or inject commands', () => {
  const output = `not ok 1 - large failure\n  ---\n  error: '${'x'.repeat(30000)}'\n  actual: false\n  ...\nnot ok 2 - second failure\n  ---\n  error: 'bad %0A::notice::text'\n  location: 'second.test.mjs:9:2'\n  ...\n${'passing tail\n'.repeat(50)}`;
  const annotation = failureAnnotation('test', failureLines(output, ''), 'full.log');
  assert.ok(annotation.includes('second failure'));
  assert.ok(annotation.includes('second.test.mjs:9:2'));
  assert.ok(annotation.includes('%250A::notice::text'));
  assert.ok(annotation.includes('field excerpt; see full log'));
});

test('HARNESS: aggregate TAP overflow preserves all failures across bounded annotations', () => {
  const output = Array.from(
    { length: 10 },
    (_, i) =>
      `not ok ${i + 1} - failure-${i + 1}\n  ---\n  location: 'source-${i + 1}.test.mjs:7:2'\n  error: '${'e'.repeat(1000)}'\n  expected: '${'x'.repeat(1000)}'\n  actual: '${'y'.repeat(1000)}'\n  stack: '${'s'.repeat(1000)}'\n  ...`,
  ).join('\n');
  const annotation = failureAnnotation('test', failureLines(`${output}\n${'passing tail\n'.repeat(50)}`, ''), 'full.log');
  const commands = annotation.split('\n');
  assert.ok(commands.length > 1);
  for (const command of commands) {
    assert.ok(command.length < 17000);
    assert.ok(command.startsWith('::error::Verification failed: test'));
    assert.ok(command.endsWith('Full failure output: full.log'));
  }
  for (let i = 1; i <= 10; i++) {
    assert.ok(annotation.includes(`failure-${i}`));
    assert.ok(annotation.includes(`source-${i}.test.mjs:7:2`));
  }
});
