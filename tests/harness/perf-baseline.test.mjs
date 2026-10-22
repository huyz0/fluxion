// NFR-PERF-005 (ADR-0170, M17.25): the nightly perf job judges a layout bench in calibration units (its p50 over the frozen calibration
// workload's, run in the same process) against perf-baseline.calibrated.json, and its p99 against the absolute budget. These cases feed the
// judge fake reports instead of running the benches.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { BENCHES, CALIBRATION, judge, RUNS, readingOf } from '../../scripts/ci/perf-baseline.mjs';
import { REPO } from './helpers.mjs';

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

  it('NFR-PERF-005: the calibration workload imports nothing from the project, and every judged bench file exists', () => {
    const cal = readFileSync(join(REPO, CALIBRATION[1]), 'utf8');
    assert.deepEqual(
      [...cal.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]),
      ['vitest'],
    );
    for (const [, file] of BENCHES) assert.ok(readFileSync(join(REPO, file), 'utf8').length > 0, file);
    assert.ok(RUNS >= 3);
  });

  it('NFR-PERF-005: the judge reads the tolerance from the thresholds, not a literal', () => {
    const src = readFileSync(join(REPO, 'scripts/ci/perf-baseline.mjs'), 'utf8');
    assert.match(src, /t\('PERF_REGRESSION_TOLERANCE_PCT'\)/);
    assert.doesNotMatch(src, /\* 1\.15/);
  });
});
