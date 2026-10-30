// The nightly perf job's layout and pack-encode check (NFR-PERF-005, ADR-0170): run the layered, tree, radial and mindmap benches and the
// full-collection pack encode (M18.126) and hold each to its threshold
// (p99 ms, the budget itself) and to PERF_REGRESSION_TOLERANCE_PCT over its calibrated baseline. A hosted runner is a different machine each night
// (layered-500 read 238, 172 and 136 ms p99 on the same code, M17.25), so the regression is judged in calibration units: the bench's p50 over the
// p50 of the frozen calibration workload (packages/layout/bench/calibration.bench.ts) run in the same Vitest process, the median of RUNS runs.
// perf-baseline.calibrated.json holds those units per bench; re-record it from a nightly run only with a `Threshold-change:` trailer.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { run } from '../gates/lib.mjs';
import { t } from '../gates/thresholds.mjs';

export const CALIBRATION = ['calibration', 'packages/layout/bench/calibration.bench.ts'];
export const BENCHES = [
  ['layered-100', 'packages/layout/bench/layered-100.bench.ts', 'LAYOUT_100_NODES_MS'],
  ['layered-500', 'packages/layout/bench/layered-500.bench.ts', 'LAYOUT_500_NODES_MS'],
  // the M17 layouts the plan holds to the same 500-node limit (M17.38)
  ['tree-500', 'packages/layout/bench/tree-500.bench.ts', 'LAYOUT_500_NODES_MS'],
  ['radial-500', 'packages/layout/bench/radial-500.bench.ts', 'LAYOUT_500_NODES_MS'],
  ['mindmap-500', 'packages/layout/bench/mindmap-500.bench.ts', 'LAYOUT_500_NODES_MS'],
  // a complete imported Iconify collection encoded as a saveable pack (M18.126, cp13 F4)
  ['iconify-pack-2198', 'packages/format/bench/iconify-pack-2198.bench.ts', 'ICONIFY_PACK_2198_MAX_MS'],
];
/** Runs per bench; the median of each reading is judged. */
export const RUNS = 5;

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const positiveFinite = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;

function arrayOf(value, label, nonempty = false) {
  if (!Array.isArray(value) || (nonempty && !value.length)) throw new Error(`malformed ${label}`);
  return value;
}

function tasksOf(assertion) {
  if (assertion?.status !== 'passed') throw new Error(`bench tests failed: ${assertion?.title ?? 'unknown'}`);
  return arrayOf(assertion.benchmarks, 'benchmarks').flatMap((b) => arrayOf(b?.tasks, 'bench tasks'));
}

/** The latency of each unique task in a Vitest 5 JSON bench report, by task name. */
export function latencies(report) {
  const by = Object.create(null);
  const assertions = arrayOf(report?.testResults, 'bench report', true).flatMap((f) => arrayOf(f?.assertionResults, 'bench assertions', true));
  for (const task of assertions.flatMap(tasksOf)) {
    if (typeof task?.name !== 'string' || !task.name) throw new Error('malformed bench task');
    if (Object.hasOwn(by, task.name)) throw new Error(`duplicate bench task: ${task.name}`);
    by[task.name] = task.latency;
  }
  return by;
}

/** One run's finite positive p99 and calibration ratio, or a string naming invalid evidence. */
export function readingOf(report, name) {
  let by;
  try {
    by = latencies(report);
  } catch (error) {
    return error.message;
  }
  const [bench, cal] = [by[name], by[CALIBRATION[0]]];
  if (!(positiveFinite(bench?.p50) && positiveFinite(bench?.p99))) return `no ${name} latency in the report`;
  if (!positiveFinite(cal?.p50)) return 'no calibration latency in the report';
  const units = bench.p50 / cal.p50;
  if (!positiveFinite(units)) return 'invalid calibration ratio';
  return { p99: bench.p99, units };
}

/**
 * The verdict on bench `name` from its runs' readings: PASS when the median p99 is within `limitMs` and the median units within `tolerancePct`
 * over `baseline` (calibration units). Without a baseline it fails and names the units to record.
 */
export function judge({ name, readings, limitMs, baseline, tolerancePct }) {
  if (!Array.isArray(readings) || !readings.length || readings.some((r) => !positiveFinite(r?.p99) || !positiveFinite(r?.units))) {
    return { pass: false, line: `FAIL ${name}: missing or malformed readings` };
  }
  const p99 = median(readings.map((r) => r.p99));
  const units = median(readings.map((r) => r.units));
  const unitLimit = typeof baseline === 'number' ? baseline * (1 + tolerancePct / 100) : Number.NaN;
  const pass = p99 <= limitMs && units <= unitLimit;
  const shown = readings.map((r) => r.units.toFixed(3)).join(', ');
  const record = Number.isFinite(unitLimit) ? '' : ` (perf-baseline.calibrated.json has no "${name}" entry: record ${units.toFixed(3)})`;
  const against = Number.isFinite(unitLimit) ? `limit ${unitLimit.toFixed(3)} (baseline ${baseline} + ${tolerancePct} %)` : 'no baseline';
  return {
    pass,
    line: `${pass ? 'PASS' : 'FAIL'} ${name}: ${units.toFixed(3)} calibration units, ${against}, median of ${shown}; p99 ${p99.toFixed(1)} ms, limit ${limitMs} ms${record}`,
  };
}

/** Run the calibration workload and one bench file in one Vitest process, files one after the other; the parsed JSON report. */
function runPair(file) {
  const dir = mkdtempSync(join(tmpdir(), 'perf-'));
  try {
    const out = join(dir, 'bench.json');
    const args = ['exec', 'vitest', 'bench', '--run', '--project', 'node (bench)', '--no-file-parallelism', '--reporter=json', `--outputFile=${out}`];
    const r = run('pnpm', [...args, CALIBRATION[1], file]);
    if (r.status !== 0) return `no bench output (exit ${r.status}): ${String(r.stderr ?? '').slice(-400)}`;
    try {
      return JSON.parse(readFileSync(out, 'utf8'));
    } catch {
      return `no bench output (exit ${r.status}): ${String(r.stderr ?? '').slice(-400)}`;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** RUNS readings of bench `name`, or the first problem as a string. */
function readingsOf(name, file) {
  const readings = [];
  for (let i = 0; i < RUNS; i += 1) {
    const report = runPair(file);
    const reading = typeof report === 'string' ? report : readingOf(report, name);
    if (typeof reading === 'string') return reading;
    readings.push(reading);
  }
  return readings;
}

/** The calibrated baselines, by bench name. */
export function calibratedBaselines() {
  return JSON.parse(readFileSync(new URL('../../perf-baseline.calibrated.json', import.meta.url), 'utf8'));
}

/**
 * Run bench `name` (in `file`) RUNS times beside the calibration workload and judge it against `limitMs` and its calibrated baseline. Shared by
 * this job and the completion gates' bench legs under CI (M17.42).
 */
export function calibratedVerdict(name, file, limitMs, baselines = calibratedBaselines()) {
  const readings = readingsOf(name, file);
  if (typeof readings === 'string') return { pass: false, line: `FAIL ${name}: ${readings}` };
  return judge({ name, readings, limitMs, baseline: baselines[name], tolerancePct: t('PERF_REGRESSION_TOLERANCE_PCT') });
}

/** Preserve the verdict details, using an escaped error annotation for failures on GitHub Actions. */
export function verdictOutput(verdict, githubActions) {
  if (!githubActions || verdict.pass) return [verdict.line];
  const data = verdict.line.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  return [`::error::${data}`];
}

function main() {
  const baselines = calibratedBaselines();
  const problems = [];
  for (const [name, file, key] of BENCHES) {
    const verdict = calibratedVerdict(name, file, t(key), baselines);
    for (const line of verdictOutput(verdict, process.env.GITHUB_ACTIONS === 'true')) console.log(line);
    if (!verdict.pass) problems.push(name);
  }
  process.exit(problems.length === 0 ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
