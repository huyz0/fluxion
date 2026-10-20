// The nightly perf job's layout check (NFR-PERF-005): run the layered benches and hold each p99 to its threshold and to 15 % over
// perf-baseline.json (p99 ms per bench; re-record it by hand after a deliberate change, with the reason in the commit).
// Each bench runs RUNS times and is judged by the median of its p99s: one run's p99 of ~20 samples is its slowest sample, which a single
// GC pause or runner hiccup sets (layered-500 read 145-248 ms on the same code, M17.25); the limit itself is unchanged.
import { readFileSync } from 'node:fs';
import { benchUnder } from '../gates/milestone-checks.mjs';
import { t } from '../gates/thresholds.mjs';

const BENCHES = [
  ['layered-100', 'packages/layout/bench/layered-100.bench.ts', 'LAYOUT_100_NODES_MS'],
  ['layered-500', 'packages/layout/bench/layered-500.bench.ts', 'LAYOUT_500_NODES_MS'],
];
const baseline = JSON.parse(readFileSync(new URL('../../perf-baseline.json', import.meta.url), 'utf8'));
/** Runs per bench; the median p99 is judged. */
const RUNS = 3;
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const problems = [];
for (const [name, file, key] of BENCHES) {
  const limit = Math.min(t(key), (baseline[name] ?? Number.NaN) * 1.15);
  // a limit of -1 always fails with the measured p99 in its message, which is judged here and printed for the re-record
  const verdicts = Number.isFinite(limit)
    ? Array.from({ length: RUNS }, () => String(benchUnder(file, name, -1)))
    : [`perf-baseline.json has no "${name}" entry`];
  const p99s = verdicts.map((v) => Number(v.match(/p99 ([\d.]+) ms/)?.[1]));
  const p99 = p99s.some((x) => !Number.isFinite(x)) ? Number.NaN : median(p99s);
  const verdict = verdicts.find((v) => !/p99 ([\d.]+) ms/.test(v)) ?? verdicts[0];
  const pass = Number.isFinite(limit) && p99 <= limit;
  console.log(
    `${pass ? 'PASS' : 'FAIL'} ${name} (limit ${Number.isFinite(limit) ? limit.toFixed(0) : '?'} ms): ${Number.isFinite(p99) ? `measured ${p99} ms p99 (median of ${p99s.join(', ')})` : verdict}`,
  );
  if (!pass) problems.push(name);
}
process.exit(problems.length === 0 ? 0 : 1);
