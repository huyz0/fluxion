// NFR-MNT-005: live execution evidence cannot be substituted by a partial score or a stale run.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mutationReceipt, mutationScopeHash, validateMutationEvidence } from '../../scripts/ci/mutation-evidence.mjs';
import { checkMutationRecord } from '../../scripts/gates/check-mutation-evidence.mjs';
import { createManifest } from '../../scripts/harness/mutation-shards.mjs';

const hash = 'a'.repeat(64),
  sha = 'b'.repeat(40);
const mutant = {
  id: 'm',
  file: 'packages/core/src/a.ts',
  mutatorName: 'BooleanLiteral',
  original: 'true',
  replacement: 'false',
  location: { start: { line: 1, column: 1 }, end: { line: 1, column: 5 } },
};
const plan = () =>
  createManifest({
    revision: sha,
    runner: hash,
    version: '0.1.1',
    packages: ['packages/core'],
    files: { [mutant.file]: hash },
    mutants: [mutant],
    floors: { 'packages/core': { score: 100 } },
  });
const shard = () => ({
  schemaVersion: 1,
  partition: 'core-1',
  package: 'packages/core',
  revision: sha,
  runner: hash,
  files: { [mutant.file]: hash },
  exitCode: 0,
  elapsedMs: 1000,
  report: {
    schemaVersion: 1,
    tzapVersion: '0.1.1',
    config: { scope: 'full', mutators: ['all'] },
    redTests: [],
    tests: [{ id: 'node' }],
    mutants: [{ ...mutant, status: 'Killed' }],
  },
});
const job = (name, step) => ({
  id: name === 'mutation' ? 3 : 1,
  name,
  status: 'completed',
  conclusion: 'success',
  run_attempt: 1,
  steps: [{ name: step, conclusion: 'success' }],
});
function evidence() {
  const receipt = mutationReceipt(plan(), [shard()]);
  return {
    run: { id: 123, name: 'nightly', head_sha: sha, status: 'completed', conclusion: 'failure', run_attempt: 1, path: '.github/workflows/nightly.yml' },
    jobs: [
      job('mutation-plan', 'Create complete mutation plan'),
      job('mutation (core-1)', 'Execute complete mutation partition'),
      job('mutation', 'Validate complete mutation reports'),
    ],
    annotations: [{ annotation_level: 'notice', message: `FLUXION_MUTATION_EVIDENCE ${JSON.stringify(receipt)}` }],
  };
}
describe('mutation evidence (NFR-MNT-005)', () => {
  it('accepts complete successful mutation jobs even when unrelated nightly jobs failed', () => {
    const result = validateMutationEvidence(evidence(), plan(), sha);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.receipt.scores[0].score, 100);
  });
  it('scope identity survives bookkeeping revision changes but detects sources, inventory and floors', () => {
    const p = plan(),
      before = mutationScopeHash(p);
    assert.equal(mutationScopeHash({ ...p, revision: 'c'.repeat(40), runner: 'd'.repeat(64) }), before);
    assert.notEqual(mutationScopeHash({ ...p, files: { [mutant.file]: 'e'.repeat(64) } }), before);
    assert.notEqual(mutationScopeHash({ ...p, mutants: [{ ...mutant, replacement: 'TRUE' }] }), before);
    assert.notEqual(mutationScopeHash({ ...p, floors: { 'packages/core': 99 } }), before);
  });
  it('receipt creation rejects incomplete reports, failed execution and runtime overruns', () => {
    assert.throws(() => mutationReceipt(plan(), []));
    for (const change of [
      (s) => {
        s.exitCode = 3;
      },
      (s) => {
        s.elapsedMs = 3600001;
      },
      (s) => {
        s.elapsedMs = NaN;
      },
      (s) => {
        s.report.mutants = [];
      },
    ]) {
      const s = shard();
      change(s);
      assert.throws(() => mutationReceipt(plan(), [s]));
    }
  });
  it('rejects stale, failed, skipped, missing, duplicate or retried execution', () => {
    const edits = [
      (e) => {
        e.run.head_sha = 'c'.repeat(40);
      },
      (e) => {
        e.run.status = 'in_progress';
      },
      (e) => {
        e.run.name = 'ci';
      },
      (e) => {
        e.run.run_attempt = 2;
      },
      (e) => {
        e.jobs.pop();
      },
      (e) => {
        e.jobs.push(e.jobs[1]);
      },
      (e) => {
        e.jobs[1].conclusion = 'failure';
      },
      (e) => {
        e.jobs[1].steps[0].conclusion = 'skipped';
      },
      (e) => {
        e.jobs[1].run_attempt = 2;
      },
      (e) => {
        e.annotations = [];
      },
      (e) => {
        e.annotations.push(e.annotations[0]);
      },
      (e) => {
        e.annotations[0].message = 'FLUXION_MUTATION_EVIDENCE {';
      },
    ];
    for (const edit of edits) {
      const e = evidence();
      edit(e);
      assert.equal(validateMutationEvidence(e, plan(), sha).ok, false, edit.toString());
    }
  });
  it('rejects tampered scope, partition lists, totals, floors, scores and non-finite timing', () => {
    const edits = [
      (r) => {
        r.scope = 'c'.repeat(64);
      },
      (r) => {
        r.partitions = [];
      },
      (r) => {
        r.partitions.push('core-1');
      },
      (r) => {
        r.scores[0].total = 2;
      },
      (r) => {
        r.scores[0].floor = 70;
      },
      (r) => {
        r.scores[0].score = 99;
      },
      (r) => {
        r.scores[0].valid = 0;
      },
      (r) => {
        r.maxElapsedMs = null;
      },
    ];
    for (const edit of edits) {
      const e = evidence();
      const r = mutationReceipt(plan(), [shard()]);
      edit(r);
      e.annotations[0].message = `FLUXION_MUTATION_EVIDENCE ${JSON.stringify(r)}`;
      assert.equal(validateMutationEvidence(e, plan(), sha).ok, false, edit.toString());
    }
  });
});

it('NFR-MNT-005: the gate re-reads live status and rejects missing records, changed HEAD and denied access', async () => {
  const record = { schemaVersion: 1, run: 123, sha };
  let reads = 0;
  const deps = {
    inspect: plan,
    provenance: () => sha,
    read: async () => {
      reads++;
      return evidence();
    },
  };
  await checkMutationRecord(record, 'M18', deps);
  await checkMutationRecord(record, 'M18', deps);
  assert.equal(reads, 2);
  await assert.rejects(checkMutationRecord(null, 'M18', deps), /invalid/);
  await assert.rejects(checkMutationRecord({ ...record, run: 456 }, 'M18', deps), /ID differs/);
  let calls = 0;
  await assert.rejects(checkMutationRecord(record, 'M18', { ...deps, provenance: () => (calls++ ? 'c'.repeat(40) : sha) }), /revision changed/);
  await assert.rejects(
    checkMutationRecord(record, 'M18', {
      ...deps,
      read: async () => {
        throw new Error('access denied');
      },
    }),
    /access denied/,
  );
  await assert.rejects(
    checkMutationRecord(record, 'M18', {
      ...deps,
      read: async () => {
        const e = evidence();
        e.jobs[1].conclusion = 'failure';
        return e;
      },
    }),
    /failed/,
  );
});
