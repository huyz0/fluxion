// ADR-0190: quick latency is visible; correctness and staged latency remain blocking.
import { advisoryLines } from './failure-report.mjs';
import { t } from './thresholds.mjs';

export const validLatency = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;

export function gateLatency(mode, elapsed, failed) {
  const target = t(mode === 'quick' ? 'QUICK_GATE_BUDGET_MS' : 'PRECOMMIT_BUDGET_MS');
  if (mode === 'all' || elapsed <= target) return { failed, lines: [] };
  if (mode === 'quick') {
    return { failed, lines: [`ADVISORY quick latency: ${elapsed}ms; target ${target}ms; overrun ${elapsed - target}ms (NFR-DX-002)`] };
  }
  return { failed: true, lines: [`FAIL budget — ${elapsed}ms > ${target}ms (NFR-DX-002)`] };
}

export function quickMilestoneResult(result, elapsed) {
  const timing = gateLatency('quick', elapsed, result.status !== 0);
  return { ok: !timing.failed, lines: [...new Set([...advisoryLines(result.stdout ?? ''), ...timing.lines])] };
}
