// NFR-PERF-005 (ADR-0170, M17.25): the nightly perf job judges a layout bench in calibration units (its p50 over the frozen calibration
// workload's, run in the same process) against perf-baseline.calibrated.json, and its p99 against the absolute budget. These cases feed the
// judge fake reports instead of running the benches.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { BENCHES, CALIBRATION, judge, RUNS, readingOf, verdictOutput } from '../../scripts/ci/perf-baseline.mjs';
import { out, REPO, sandbox } from './helpers.mjs';

/** A Vitest 5 JSON bench report with the calibration task and `name`'s, at the given latencies. */
function report(name, bench, cal = { p50: 30 }, status = 'passed') {
  const task = (n, latency) => ({ name: n, latency });
  return {
    testResults: [
      { assertionResults: [{ title: 'NFR-PERF-005: calibration', status: 'passed', benchmarks: [{ tasks: [task('calibration', cal)] }] }] },
      { assertionResults: [{ title: `NFR-PERF-005: ${name}`, status, benchmarks: [{ tasks: [task(name, bench)] }] }] },
    ],
  };
}

describe('perf-baseline: calibration units (NFR-PERF-005, ADR-0170)', () => {
  it('NFR-PERF-005: a reading is the p99 in ms and the p50 over the calibration p50', () => {
    assert.deepEqual(readingOf(report('layered-500', { p50: 210, p99: 260 }), 'layered-500'), { p99: 260, units: 7 });
  });

  it('NFR-PERF-005: a failed bench test, a missing task or a missing calibration is named, not judged', () => {
    assert.match(String(readingOf(report('layered-500', { p50: 1, p99: 1 }, { p50: 30 }, 'failed'), 'layered-500')), /bench tests failed/);
    assert.match(String(readingOf(report('tree-500', { p50: 1, p99: 1 }), 'layered-500')), /no layered-500 latency/);
    assert.match(String(readingOf(report('layered-500', { p50: 1, p99: 1 }, {}), 'layered-500')), /no calibration latency/);
  });

  it('NFR-PERF-005: the median units pass up to the tolerance over the baseline and fail past it; one slow run does not decide', () => {
    const at = (...units) => units.map((u) => ({ p99: 200, units: u }));
    const base = { name: 'layered-500', limitMs: 2000, baseline: 7, tolerancePct: 15 };
    assert.equal(judge({ ...base, readings: at(7, 8.05, 6.9, 20, 7.1) }).pass, true);
    assert.equal(judge({ ...base, readings: at(8.1, 8.2, 6.9, 8.06, 8.3) }).pass, false);
    assert.match(judge({ ...base, readings: at(7) }).line, /^PASS layered-500: 7\.000 calibration units, limit 8\.050 \(baseline 7 \+ 15 %\)/);
  });

  it('NFR-PERF-005: the absolute budget still holds whatever the units: a p99 over it fails', () => {
    const verdict = judge({ name: 'layered-500', limitMs: 2000, baseline: 7, tolerancePct: 15, readings: [{ p99: 2100, units: 7 }] });
    assert.equal(verdict.pass, false);
    assert.match(verdict.line, /p99 2100\.0 ms, limit 2000 ms/);
  });

  it('NFR-PERF-005: without a baseline the bench fails and names the units to record', () => {
    const verdict = judge({ name: 'tree-500', limitMs: 2000, baseline: undefined, tolerancePct: 15, readings: [{ p99: 20, units: 0.512 }] });
    assert.equal(verdict.pass, false);
    assert.match(verdict.line, /perf-baseline\.calibrated\.json has no "tree-500" entry: record 0\.512/);
  });

  it('HARNESS NFR-PERF-005: failed benchmark verdicts are annotated only in GitHub Actions without changing their details', () => {
    const failed = judge({ name: 'layered-500', limitMs: 2000, baseline: 7, tolerancePct: 15, readings: [{ p99: 2100, units: 7 }] });
    assert.equal(failed.pass, false);
    assert.deepEqual(verdictOutput(failed, true), [`::error::${failed.line.replaceAll('%', '%25')}`]);
    assert.deepEqual(verdictOutput(failed, false), [failed.line]);
    const passed = judge({ name: 'layered-500', limitMs: 2000, baseline: 7, tolerancePct: 15, readings: [{ p99: 200, units: 7 }] });
    assert.equal(passed.pass, true);
    assert.deepEqual(verdictOutput(passed, true), [passed.line]);
    assert.deepEqual(verdictOutput(passed, false), [passed.line]);
  });

  it('HARNESS: benchmark error annotation data escapes percent and line breaks so child diagnostics cannot inject commands', () => {
    const line = 'FAIL bench: 10%\r\n::warning::injected';
    assert.deepEqual(verdictOutput({ pass: false, line }, true), ['::error::FAIL bench: 10%25%0D%0A::warning::injected']);
  });

  it('HARNESS: the benchmark CLI retains failure exit status and emits annotations only when GITHUB_ACTIONS is true', () => {
    const sb = sandbox(['scripts/ci/perf-baseline.mjs', 'scripts/gates/thresholds.mjs', 'perf-baseline.calibrated.json']);
    try {
      // A deliberately failed runner exercises diagnostics, never supplies performance evidence.
      sb.write('scripts/gates/lib.mjs', "export const run = () => ({ status: 1, stderr: 'fixture benchmark unavailable' });\n");
      const ci = sb.node('scripts/ci/perf-baseline.mjs', [], { env: { ...process.env, GITHUB_ACTIONS: 'true' } });
      assert.equal(ci.status, 1, out(ci));
      assert.equal(ci.stdout.split('\n').filter((line) => line.startsWith('::error::FAIL ')).length, BENCHES.length, out(ci));
      assert.match(ci.stdout, /no bench output \(exit 1\): fixture benchmark unavailable/);
      const local = sb.node('scripts/ci/perf-baseline.mjs', [], { env: { ...process.env, GITHUB_ACTIONS: 'false' } });
      assert.equal(local.status, 1, out(local));
      assert.doesNotMatch(local.stdout, /::error::/);
      assert.equal(local.stdout.split('\n').filter((line) => line.startsWith('FAIL ')).length, BENCHES.length, out(local));
    } finally {
      sb.cleanup();
    }
  });

  it('NFR-PERF-005: the calibration workload imports nothing from the project, and every judged bench file exists', () => {
    const cal = readFileSync(join(REPO, CALIBRATION[1]), 'utf8');
    assert.deepEqual(
      [...cal.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]),
      ['vitest'],
    );
    for (const [, file] of BENCHES) assert.ok(readFileSync(join(REPO, file), 'utf8').length > 0, file);
    assert.ok(RUNS >= 3);
  });

  it('NFR-PERF-005: under CI the completion gates judge their layout bench legs in calibration units, through the same verdict (M17.42)', () => {
    const m13 = readFileSync(join(REPO, 'scripts/gates/m13-complete.mjs'), 'utf8');
    const leg = m13.match(/^function benchLeg\([\s\S]*?^\}/m)?.[0] ?? '';
    assert.match(leg, /if \(process\.env\.CI\) \{\s*const verdict = calibratedVerdict\(name, file, limit\);/);
    assert.doesNotMatch(m13, /1\.15|nightly perf job holds the runner/);
    assert.match(m13, /^import \{ calibratedVerdict \} from '\.\.\/ci\/perf-baseline\.mjs';$/m);
    // the M17 gate's 500-node legs hold the absolute limit only, so no ms baseline can flake them on a hosted runner
    assert.doesNotMatch(readFileSync(join(REPO, 'scripts/gates/m17-complete.mjs'), 'utf8'), /perf-baseline/);
  });

  it('NFR-PERF-005: the judge reads the tolerance from the thresholds, not a literal', () => {
    const src = readFileSync(join(REPO, 'scripts/ci/perf-baseline.mjs'), 'utf8');
    assert.match(src, /t\('PERF_REGRESSION_TOLERANCE_PCT'\)/);
    assert.doesNotMatch(src, /\* 1\.15/);
  });
});
