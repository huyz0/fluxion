import assert from 'node:assert/strict';
import { it } from 'node:test';
import { gateLatency, quickMilestoneResult, validLatency } from '../../scripts/gates/gate-latency.mjs';
import { t } from '../../scripts/gates/thresholds.mjs';

it('NFR-DX-002: quick latency boundary is advisory without hiding failed checks', () => {
  const limit = t('QUICK_GATE_BUDGET_MS');
  for (const ms of [limit - 1, limit, limit + 1]) {
    const good = gateLatency('quick', ms, false);
    assert.equal(good.failed, false);
    assert.equal(good.lines.length, ms > limit ? 1 : 0);
    if (ms > limit) assert.equal(good.lines[0], `ADVISORY quick latency: ${ms}ms; target ${limit}ms; overrun 1ms (NFR-DX-002)`);
    assert.equal(gateLatency('quick', ms, true).failed, true);
  }
});
it('NFR-DX-002: staged latency remains hard and all-mode subcheck failure remains failed', () => {
  const limit = t('PRECOMMIT_BUDGET_MS');
  assert.equal(gateLatency('staged', limit, false).failed, false);
  const over = gateLatency('staged', limit + 1, false);
  assert.equal(over.failed, true);
  assert.match(over.lines[0], /^FAIL budget/);
  assert.equal(gateLatency('all', limit + 1, true).failed, true);
});
it('NFR-DX-002: absent or invalid timings cannot qualify a budget record', () => {
  for (const value of [undefined, null, '', '1', 0, -1, NaN, Infinity, -Infinity]) assert.equal(validLatency(value), false);
  for (const value of [1, 180001]) assert.equal(validLatency(value), true);
});
it('NFR-DX-002 NFR-MNT-004: M0 surfaces quick advisories and preserves process failure', () => {
  const ms = t('QUICK_GATE_BUDGET_MS') + 1;
  const stdout = 'ADVISORY original warning\nVERIFY quick: PASS';
  const good = quickMilestoneResult({ status: 0, stdout, stderr: '' }, ms);
  assert.equal(good.ok, true);
  assert.ok(good.lines.includes('ADVISORY original warning'));
  assert.ok(good.lines.some((line) => line.includes('overrun 1ms')));
  for (const status of [1, null]) assert.equal(quickMilestoneResult({ status, stdout, stderr: 'failure' }, ms).ok, false);
});
