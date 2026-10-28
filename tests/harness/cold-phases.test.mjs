// NFR-DX-001: a red cold setup names the phase that made it red (M18.154, cp17 F1).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { coldReport, ladderSteps, runPhases } from '../../scripts/gates/cold-phases.mjs';
import { t } from '../../scripts/gates/thresholds.mjs';

const LIMIT = t('COLD_SETUP_MAX_MS');

/** A stub phase runner: each phase advances a fake clock by its `ms` and exits with `status`. */
function stubPhases(specs) {
  let clock = 0;
  const phases = specs.map(({ name, ms, status = 0, stdout = '' }) => ({
    name,
    run: () => {
      clock += ms;
      return { status, stdout, stderr: '' };
    },
  }));
  return runPhases(phases, () => clock);
}

describe('cold setup phases (M18.154)', () => {
  it('reads PASS and FAIL ladder lines and ignores the rest', () => {
    assert.deepEqual(ladderSteps('PASS lint (12ms)\nSKIP knip — off\nFAIL test (34ms)\n    detail\nVERIFY all: FAIL (1.0s)'), [
      { name: 'lint', ms: 12, ok: true },
      { name: 'test', ms: 34, ok: false },
    ]);
  });

  it('over the limit by time, names the slowest phase or ladder step', () => {
    const phases = stubPhases([
      { name: 'install', ms: 100_000 },
      { name: 'setup', ms: 50_000 },
      { name: 'verify', ms: LIMIT, stdout: 'PASS lint (20000ms)\nPASS e2e (400000ms)\nPASS test (300000ms)' },
    ]);
    const report = coldReport(phases, LIMIT);
    assert.equal(report.totalMs, LIMIT + 150_000);
    assert.match(report.blame, new RegExp(`failed by time \\(${LIMIT + 150_000} ms > ${LIMIT} ms\\); slowest phase verify:e2e 400000 ms`));
    assert.ok(report.lines.includes('budget: cold phase install 100000 ms'));
    assert.ok(report.lines.includes('budget: cold phase verify:e2e 400000 ms'));
  });

  it('a phase without ladder steps can be the slowest', () => {
    const phases = stubPhases([
      { name: 'install', ms: LIMIT },
      { name: 'setup', ms: 1 },
      { name: 'verify', ms: 1000, stdout: 'PASS lint (900ms)' },
    ]);
    assert.match(coldReport(phases, LIMIT).blame, /slowest phase install /);
  });

  it('under the limit, a failing ladder step is named by status and later phases do not run', () => {
    const phases = stubPhases([
      { name: 'install', ms: 1000 },
      { name: 'verify', ms: 5000, status: 1, stdout: 'PASS lint (1000ms)\nFAIL test (3000ms)' },
      { name: 'never', ms: 1 },
    ]);
    assert.deepEqual(
      phases.map((p) => p.name),
      ['install', 'verify'],
    );
    const report = coldReport(phases, LIMIT);
    assert.equal(report.blame, 'budget: cold setup failed by status in phase verify:test after 3000 ms');
    assert.ok(report.lines.includes('budget: cold phase verify 5000 ms (failed)'));
  });

  it('a failed phase without ladder output is named itself; within the limit nothing is blamed', () => {
    assert.match(coldReport(stubPhases([{ name: 'install', ms: 10, status: 1 }]), LIMIT).blame, /by status in phase install after 10 ms/);
    assert.equal(coldReport(stubPhases([{ name: 'install', ms: 10 }]), LIMIT).blame, null);
  });
});
