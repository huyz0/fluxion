// NFR-DX-001: completion gates share one verify leg, and it judges the recorded budget even when the
// caller exports CI=true (ADR-0143; M2.29 review F1/F2).
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { verifyLeg } from '../../scripts/gates/milestone-checks.mjs';
import { out, sandbox } from './helpers.mjs';

let sb;
const STALE = {
  recordedAt: '2026-09-27T00:00:00.000Z',
  commit: 'abc1234',
  node: '22.19.0',
  platform: 'linux-x64',
  quickMs: 2_000,
  stagedMs: 60_000,
  coldSetupMs: 200_000,
  lockfile: 'none', // the sandbox below has a pnpm-lock.yaml, so this record is stale
};

describe('shared verify leg (NFR-DX-001, ADR-0143)', () => {
  let savedCi;
  beforeEach(() => {
    sb = sandbox(['scripts']);
    sb.write('pnpm-lock.yaml', "lockfileVersion: '9.0'\n");
    sb.write('budget.json', JSON.stringify(STALE));
    savedCi = process.env.CI;
    process.env.CI = 'true';
  });
  afterEach(() => {
    if (savedCi === undefined) delete process.env.CI;
    else process.env.CI = savedCi;
    sb.cleanup();
  });

  const budgetCommand = () => [process.execPath, [sb.path('scripts/gates/check-budget.mjs'), '--file', sb.path('budget.json')]];

  it('stale budget record fails the shared verify leg under CI=true', () => {
    // control: with the exported CI=true inherited, the budget step alone accepts the stale record
    const inherited = sb.node('scripts/gates/check-budget.mjs', ['--file', sb.path('budget.json')], { env: process.env });
    assert.equal(inherited.status, 0, out(inherited));
    const leg = verifyLeg(['budget'], { command: budgetCommand(), cwd: sb.dir });
    assert.notEqual(leg, true);
    assert.match(String(leg), /predates the current pnpm-lock\.yaml/);
  });

  it('passes only when every required step printed PASS and no untolerated SKIP', () => {
    const script = (lines) => [process.execPath, ['-e', `console.log(${JSON.stringify(lines.join('\n'))})`]];
    assert.equal(verifyLeg(['lint', 'test'], { command: script(['PASS lint (1ms)', 'PASS test (1ms)', 'SKIP workflows — Docker not available']) }), true);
    assert.match(String(verifyLeg(['lint', 'test'], { command: script(['PASS lint (1ms)']) })), /test=absent/);
    assert.match(String(verifyLeg(['lint'], { command: script(['PASS lint (1ms)', 'SKIP api — no build']) })), /skipped: SKIP api/);
  });

  it('a failing ladder names each failed step with its output, not only the closing VERIFY line (precommit failure detail, M19.2)', () => {
    const lines = [
      'PASS build (1ms)',
      'FAIL lint (2ms)',
      '    scripts/x.mjs format',
      '      × Formatter would have printed the following content:',
      '    Full failure output: .harness/tmp/verify-logs/1/lint.log',
      'PASS test (1ms)',
      'ADVISORY size: 1 byte over',
      'FAIL api (3ms)',
      '    api report drift: packages/core',
      'PASS digest (1ms)',
      'VERIFY all: FAIL (1.0s)',
    ];
    const command = [process.execPath, ['-e', `console.log(${JSON.stringify(lines.join('\n'))}); process.exit(1)`]];
    const leg = String(verifyLeg(['lint', 'api'], { command }));
    assert.match(leg, /FAIL lint/);
    assert.match(leg, /Formatter would have printed/);
    assert.match(leg, /verify-logs\/1\/lint\.log/);
    assert.match(leg, /FAIL api.*api report drift/s);
    assert.doesNotMatch(leg, /PASS test|ADVISORY/);
    // a step's window longer than the kept lines keeps its end: the summary and the log path (r2 F1)
    const long = [
      'FAIL lint (2ms)',
      ...Array.from({ length: 30 }, (_, i) => `    diagnostic ${i}`),
      '    ✖ Some errors were emitted',
      '    Full failure output: .harness/tmp/verify-logs/2/lint.log',
      'VERIFY all: FAIL (1.0s)',
    ];
    const tailed = String(verifyLeg(['lint'], { command: [process.execPath, ['-e', `console.log(${JSON.stringify(long.join('\n'))}); process.exit(1)`]] }));
    assert.match(tailed, /Some errors were emitted \| Full failure output: \.harness\/tmp\/verify-logs\/2\/lint\.log$/);
    assert.match(tailed, /diagnostic 29/);
    assert.doesNotMatch(tailed, /diagnostic 0 /);
  });
});
