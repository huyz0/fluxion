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
});
