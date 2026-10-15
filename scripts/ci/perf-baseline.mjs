// The nightly perf job's layout check (NFR-PERF-005): run the layered benches and hold each p99 to its threshold and to 15 % over
// perf-baseline.json (p99 ms per bench; re-record it by hand after a deliberate change, with the reason in the commit).
import { readFileSync } from 'node:fs';
import { benchUnder } from '../gates/milestone-checks.mjs';
import { t } from '../gates/thresholds.mjs';

const BENCHES = [
  ['layered-100', 'packages/layout/bench/layered-100.bench.ts', 'LAYOUT_100_NODES_MS'],
  ['layered-500', 'packages/layout/bench/layered-500.bench.ts', 'LAYOUT_500_NODES_MS'],
];
const baseline = JSON.parse(readFileSync(new URL('../../perf-baseline.json', import.meta.url), 'utf8'));
const problems = [];
for (const [name, file, key] of BENCHES) {
  const limit = Math.min(t(key), (baseline[name] ?? Number.NaN) * 1.15);
  const verdict = Number.isFinite(limit) ? benchUnder(file, name, limit) : `perf-baseline.json has no "${name}" entry`;
  console.log(
    `${verdict === true ? 'PASS' : 'FAIL'} ${name} (limit ${Number.isFinite(limit) ? limit.toFixed(0) : '?'} ms)${verdict === true ? '' : `: ${verdict}`}`,
  );
  if (verdict !== true) problems.push(name);
}
process.exit(problems.length === 0 ? 0 : 1);
