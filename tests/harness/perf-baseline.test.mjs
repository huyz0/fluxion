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

  it('HARNESS NFR-PERF-005: the benchmark CLI annotates threshold failures with measured units and absolute latency', () => {
    const sb = sandbox(['scripts/ci/perf-baseline.mjs', 'scripts/gates/thresholds.mjs', 'perf-baseline.calibrated.json']);
    try {
      // Synthetic over-budget reports test the diagnostic path, never qualify a performance gate. p99 30 s is over every
      // bench budget, the 4 s full-collection pack encode included (M18.126).
      sb.write(
        'scripts/gates/lib.mjs',
        `import {writeFileSync} from 'node:fs';
export function run(_command,args) {
  const name=args.at(-1).split('/').at(-1).replace('.bench.ts','');
  const tasks=[{name,latency:{p50:100,p99:30000}},{name:'calibration',latency:{p50:10,p99:12}}];
  const report={testResults:[{assertionResults:[{title:name,status:'passed',benchmarks:[{tasks}]}]}]};
  writeFileSync(args.find(arg=>arg.startsWith('--outputFile=')).slice('--outputFile='.length),JSON.stringify(report));
  return {status:0,stderr:''};
}\n`,
      );
      const result = sb.node('scripts/ci/perf-baseline.mjs', [], { env: { ...process.env, GITHUB_ACTIONS: 'true' } });
      assert.equal(result.status, 1, out(result));
      const annotations = result.stdout.split('\n').filter((line) => line.startsWith('::error::FAIL '));
      assert.equal(annotations.length, BENCHES.length, out(result));
      for (const [name] of BENCHES)
        assert.ok(
          annotations.some((line) => line.startsWith(`::error::FAIL ${name}: 10.000 calibration units`)),
          out(result),
        );
      assert.match(result.stdout, /layered-500:.*p99 30000\.0 ms, limit 2000 ms/);
      assert.match(result.stdout, /baseline .* \+ 15 %25/);
    } finally {
      sb.cleanup();
    }
  });

  it('NFR-PERF-005: first sample is an outlier; all five units determine the median', () => {
    const base = { name: 'layered-500', limitMs: 2000, baseline: 7, tolerancePct: 15 };
    const readings = [20, 7, 7.1, 6.9, 7].map((units) => ({ units, p99: 200 }));
    const verdict = judge({ ...base, readings });
    assert.equal(verdict.pass, true);
    assert.match(verdict.line, /7\.000 calibration units/);
    assert.match(verdict.line, /median of 20\.000, 7\.000, 7\.100, 6\.900, 7\.000/);
  });

  it('NFR-PERF-005: varied p99 samples use the median independently of units', () => {
    const base = { name: 'layered-500', limitMs: 2000, baseline: 7, tolerancePct: 15 };
    for (const [values, pass, median] of [
      [[2100, 1800, 1900, 1850, 1950], true, 1900],
      [[1900, 2100, 2200, 2300, 2400], false, 2200],
    ]) {
      const verdict = judge({ ...base, readings: values.map((p99) => ({ p99, units: 7 })) });
      assert.equal(verdict.pass, pass);
      assert.ok(verdict.line.includes(`p99 ${median.toFixed(1)} ms`), verdict.line);
    }
  });

  it('NFR-PERF-005: malformed or ambiguous reports never become readings', () => {
    for (const value of [Infinity, NaN, '30', 0, -1, null]) {
      for (const field of ['p50', 'p99']) {
        assert.equal(typeof readingOf(report('layered-500', { p50: 30, p99: 40, [field]: value }), 'layered-500'), 'string');
      }
      assert.equal(typeof readingOf(report('layered-500', { p50: 30, p99: 40 }, { p50: value }), 'layered-500'), 'string');
    }
    for (const invalid of [null, {}, { testResults: [] }, { testResults: [null] }]) {
      assert.equal(typeof readingOf(invalid, 'layered-500'), 'string');
    }
    const duplicate = report('layered-500', { p50: 30, p99: 40 });
    duplicate.testResults.push(duplicate.testResults[1]);
    assert.match(readingOf(duplicate, 'layered-500'), /duplicate/);
    assert.equal(typeof readingOf(report('layered-500', { p50: Number.MAX_VALUE, p99: 40 }, { p50: Number.MIN_VALUE }), 'layered-500'), 'string');
  });

  it('NFR-PERF-005: the judge rejects every malformed reading instead of hiding it in a median', () => {
    const base = { name: 'layered-500', limitMs: 2000, baseline: 7, tolerancePct: 15 };
    for (const invalid of [null, {}, { p99: Infinity, units: 7 }, { p99: 200, units: NaN }, { p99: '200', units: 7 }]) {
      const readings = [{ p99: 200, units: 7 }, invalid, { p99: 200, units: 7 }];
      assert.equal(judge({ ...base, readings }).pass, false);
    }
    assert.equal(judge({ ...base, readings: [] }).pass, false);
  });

  it('NFR-PERF-005: a nonzero benchmark process fails even with a passing JSON report', () => {
    const sb = sandbox(['scripts/ci/perf-baseline.mjs', 'scripts/gates/thresholds.mjs', 'perf-baseline.calibrated.json']);
    try {
      // Synthetic reports test failed-process handling, never qualify performance.
      sb.write(
        'scripts/gates/lib.mjs',
        `import {writeFileSync} from 'node:fs';
export function run(_command,args) {
  const name=args.at(-1).split('/').at(-1).replace('.bench.ts','');
  const tasks=[{name,latency:{p50:1,p99:1}},{name:'calibration',latency:{p50:100,p99:100}}];
  writeFileSync(args.find(arg=>arg.startsWith('--outputFile=')).slice('--outputFile='.length),JSON.stringify({testResults:[{assertionResults:[{status:'passed',benchmarks:[{tasks}]}]}]}));
  return {status:1,stderr:'fixture process failed after writing'};
}\n`,
      );
      const result = sb.node('scripts/ci/perf-baseline.mjs');
      assert.equal(result.status, 1, out(result));
      assert.match(result.stdout, /exit 1.*fixture process failed after writing/);
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

  it('NFR-PERF-005: every retained millisecond baseline has a gate reader', () => {
    const sb = sandbox(['scripts', 'perf-baseline.json', 'packages/layout/bench']);
    try {
      sb.write('scripts/gates/real-lib.mjs', sb.read('scripts/gates/lib.mjs'));
      // Execute the actual M13 local legs, replacing only their benchmark process.
      // Removing each baseline must prevent its leg from measuring anything.
      sb.write(
        'scripts/gates/lib.mjs',
        `export * from './real-lib.mjs';
import {leg as register} from './real-lib.mjs';
import {writeFileSync} from 'node:fs';
export function leg(name,fn) { if(/^layered (100|500) nodes/.test(name)) register(name,fn); }
export function run(_cmd,args) {
 const file=args.at(-1), name=file.split('/').at(-1).replace('.bench.ts','');
 const tasks=[{name,latency:{p99:1}}];
 writeFileSync(args.find(a=>a.startsWith('--outputFile=')).slice(13),JSON.stringify({testResults:[{assertionResults:[{status:'passed',benchmarks:[{tasks}]}]}]}));
 console.log('MEASURED '+name);
 return {status:0,stdout:'',stderr:''};
}\n`,
      );
      const baselines = JSON.parse(sb.read('perf-baseline.json'));
      const local = () => sb.node('scripts/gates/m13-complete.mjs', [], { env: { ...process.env, CI: '' } });
      const initial = local();
      assert.equal(initial.status, 0, out(initial));
      const measured = [...initial.stdout.matchAll(/^MEASURED (.+)$/gm)].map((m) => m[1]).sort();
      assert.deepEqual(Object.keys(baselines).sort(), measured);
      assert.equal(measured.length, 2);
      for (const name of measured) {
        const missing = { ...baselines };
        delete missing[name];
        sb.write('perf-baseline.json', JSON.stringify(missing));
        const result = local();
        assert.equal(result.status, 1, out(result));
        assert.ok(result.stdout.includes(`perf-baseline.json has no "${name}" entry`), out(result));
        assert.ok(!result.stdout.includes(`MEASURED ${name}`), out(result));
      }
    } finally {
      sb.cleanup();
    }
  });

  it('NFR-PERF-005: the judge reads the tolerance from the thresholds, not a literal', () => {
    const src = readFileSync(join(REPO, 'scripts/ci/perf-baseline.mjs'), 'utf8');
    assert.match(src, /t\('PERF_REGRESSION_TOLERANCE_PCT'\)/);
    assert.doesNotMatch(src, /\* 1\.15/);
  });
});
