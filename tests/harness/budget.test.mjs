// NFR-DX-001 / NFR-DX-002: recorded gate latencies (cold setup, quick, staged) stay within the thresholds.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { t } from '../../scripts/gates/thresholds.mjs';
import { out, REPO, sandbox } from './helpers.mjs';

let sb;
const OK = {
  recordedAt: '2026-09-27T00:00:00.000Z',
  commit: 'abc1234',
  node: '22.19.0',
  platform: 'linux-x64',
  quickMs: 2_000,
  stagedMs: 60_000,
  coldSetupMs: 200_000,
  lockfile: 'none', // the sandbox has no pnpm-lock.yaml
};
const budget = (record) => {
  if (record !== undefined) sb.write('budget.json', JSON.stringify(record));
  return sb.node('scripts/gates/check-budget.mjs', ['--file', sb.path('budget.json')]);
};

describe('check-budget (NFR-DX-001, NFR-DX-002)', () => {
  beforeEach(() => {
    sb = sandbox(['scripts']);
  });
  afterEach(() => sb.cleanup());

  it('passes a record within every threshold', () => {
    const r = budget(OK);
    assert.equal(r.status, 0, out(r));
  });

  const over = {
    'a pre-commit gate over PRECOMMIT_BUDGET_MS': ['stagedMs', t('PRECOMMIT_BUDGET_MS') + 1],
    'a quick gate over QUICK_GATE_BUDGET_MS': ['quickMs', t('QUICK_GATE_BUDGET_MS') + 1],
    'a cold setup over COLD_SETUP_MAX_MS (10 min)': ['coldSetupMs', t('COLD_SETUP_MAX_MS') + 1],
  };
  for (const [name, [key, value]] of Object.entries(over)) {
    it(`fails on ${name}`, () => {
      const r = budget({ ...OK, [key]: value });
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, new RegExp(`${key} ${value} ms > `));
    });
  }

  it('fails when a run failed (null) or the record is missing', () => {
    const failed = budget({ ...OK, coldSetupMs: null });
    assert.equal(failed.status, 1, out(failed));
    assert.match(failed.stderr, /coldSetupMs not recorded/);
    const missing = sb.node('scripts/gates/check-budget.mjs', ['--file', sb.path('nope.json')]);
    assert.equal(missing.status, 1, out(missing));
    assert.match(missing.stderr, /is missing: run check-budget\.mjs --record/);
  });

  it('fails when the record predates the lockfile (M1.19 review F2)', () => {
    sb.write('pnpm-lock.yaml', "lockfileVersion: '9.0'\n");
    const r = budget(OK);
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /predates the current pnpm-lock\.yaml/);
  });

  it('the committed record is within the thresholds (cold setup < 10 min, NFR-DX-001)', () => {
    const record = JSON.parse(readFileSync(join(REPO, '.harness/budget.json'), 'utf8'));
    assert.ok(record.coldSetupMs > 0 && record.coldSetupMs <= t('COLD_SETUP_MAX_MS'), JSON.stringify(record));
    assert.ok(record.stagedMs <= t('PRECOMMIT_BUDGET_MS') && record.quickMs <= t('QUICK_GATE_BUDGET_MS'), JSON.stringify(record));
  });
});
