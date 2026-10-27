// NFR-MNT-005: partitions must cover the independent inventory before package scores count.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { aggregatePartitions, MATRIX_CHAINS, MATRIX_JOBS_MAX, matrixChains, partitionManifest } from '../../scripts/harness/mutation-partitions.mjs';
import { createManifest } from '../../scripts/harness/mutation-shards.mjs';

const hash = 'a'.repeat(64);
const mutant = (file, id) => ({
  id,
  file,
  mutatorName: 'BooleanLiteral',
  original: 'true',
  replacement: 'false',
  location: { start: { line: 1, column: 1 }, end: { line: 1, column: 5 } },
});
function manifest() {
  const files = Object.fromEntries(['a.ts', 'b.ts', 'empty.ts'].map((f) => [`packages/core/src/${f}`, hash]));
  files['packages/anim/src/a.ts'] = hash;
  return createManifest({
    revision: 'b'.repeat(40),
    runner: hash,
    version: '0.1.1',
    packages: ['packages/core', 'packages/anim'],
    files,
    mutants: [mutant('packages/core/src/a.ts', 'a'), mutant('packages/core/src/b.ts', 'b'), mutant('packages/anim/src/a.ts', 'c')],
    floors: { 'packages/core': { score: 100 } },
  });
}
function shard(plan, part, status = 'Killed') {
  const files = Object.fromEntries(Object.entries(plan.files).filter(([f]) => f.startsWith(`${part.package}/src/`)));
  return {
    schemaVersion: 1,
    partition: part.id,
    package: part.package,
    revision: plan.revision,
    runner: plan.runner,
    files,
    exitCode: 0,
    report: {
      schemaVersion: 1,
      tzapVersion: '0.1.1',
      config: { scope: 'full', mutators: ['all'] },
      redTests: [],
      tests: [{ id: 'node' }, { id: 'browser' }],
      mutants: plan.mutants.filter((m) => part.files.includes(m.file)).map((m) => ({ ...m, status })),
    },
  };
}

describe('complete source partitions (NFR-MNT-005)', () => {
  it('is deterministic, exhaustive and disjoint including zero-mutant files', () => {
    const plan = manifest(),
      parts = partitionManifest(plan, 1);
    assert.equal(parts.length, 3);
    assert.deepEqual(parts.flatMap((p) => p.files).sort(), Object.keys(plan.files).sort());
    assert.equal(new Set(parts.flatMap((p) => p.files)).size, Object.keys(plan.files).length);
    assert.deepEqual(
      partitionManifest({ ...plan, mutants: [...plan.mutants].reverse(), files: Object.fromEntries(Object.entries(plan.files).reverse()) }, 1),
      parts,
    );
    assert.throws(() => partitionManifest(plan, 0));
    assert.throws(() => partitionManifest({ ...plan, mutants: [...plan.mutants, plan.mutants[0]] }, 1));
  });
  it('keeps an oversized file intact rather than sampling its mutants', () => {
    const plan = manifest();
    plan.mutants.push(mutant('packages/core/src/a.ts', 'extra'));
    const part = partitionManifest(plan, 1).find((p) => p.files.includes('packages/core/src/a.ts'));
    assert.equal(part.mutants, 2);
    assert.equal(part.files.filter((f) => f.endsWith('a.ts')).length, 1);
  });
  it('keeps zero-mutant inputs with an oversized source instead of creating an empty group', () => {
    const plan = manifest();
    delete plan.files['packages/core/src/b.ts'];
    plan.mutants = plan.mutants.filter((m) => m.id !== 'b');
    plan.mutants.push(mutant('packages/core/src/a.ts', 'extra'));
    const parts = partitionManifest(plan, 1).filter((p) => p.package === 'packages/core');
    assert.equal(parts.length, 1);
    assert.ok(parts[0].files.includes('packages/core/src/empty.ts'));
  });

  it('scores a complete package union, allowing a compile-only group but not a zero-valid package', () => {
    const plan = manifest(),
      parts = partitionManifest(plan, 1),
      reports = parts.map((p) => shard(plan, p));
    reports.find((s) => s.report.mutants.some((m) => m.id === 'a')).report.mutants[0].status = 'CompileError';
    const result = aggregatePartitions(plan, reports, 1);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(
      result.scores.find((s) => s.package === 'packages/core'),
      { package: 'packages/core', valid: 1, total: 2, score: 100, floor: 100 },
    );
    reports.find((s) => s.report.mutants.some((m) => m.id === 'b')).report.mutants[0].status = 'CompileError';
    assert.equal(aggregatePartitions(plan, reports, 1).ok, false);
  });
  it('rejects zero-valid runtime-error or ignored groups even when another group passes', () => {
    const plan = manifest(),
      parts = partitionManifest(plan, 1);
    for (const status of ['RuntimeError', 'Ignored']) {
      const reports = parts.map((p) => shard(plan, p));
      reports.find((s) => s.report.mutants.some((m) => m.id === 'a')).report.mutants[0].status = status;
      const result = aggregatePartitions(plan, reports, 1);
      assert.equal(result.ok, false, `${status}: ${JSON.stringify(result)}`);
      assert.match(result.errors.join('\n'), /zero-valid partition/);
    }
  });

  it('enforces unchanged floors after aggregation, never trusts a reported score', () => {
    const plan = manifest(),
      parts = partitionManifest(plan, 1),
      reports = parts.map((p) => shard(plan, p));
    const core = reports.find((s) => s.package === 'packages/core');
    core.report.mutants[0].status = 'Survived';
    core.report.score = 100;
    const result = aggregatePartitions(plan, reports, 1);
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /50.0 % < 100 %/);
  });
  it('rejects missing, duplicate, failed, stale, partial and unfinished evidence', () => {
    const plan = manifest(),
      parts = partitionManifest(plan, 1);
    const edits = [
      (r) => r.pop(),
      (r) => r.push(r[0]),
      (r) => {
        r[0].exitCode = 3;
      },
      (r) => {
        r[0].revision = 'c'.repeat(40);
      },
      (r) => {
        r[0].report.mutants = [];
      },
      (r) => {
        r[0].report.mutants[0].status = 'Pending';
      },
      (r) => {
        r[0].partition = 'unknown';
      },
      (r) => {
        r[0].report.redTests = ['failed'];
      },
      (r) => {
        r[0].report.config.scope = 'diff';
      },
      (r) => {
        r[0].files[Object.keys(r[0].files)[0]] = 'd'.repeat(64);
      },
    ];
    for (const edit of edits) {
      const reports = parts.map((p) => shard(plan, p));
      edit(reports);
      assert.equal(aggregatePartitions(plan, reports, 1).ok, false, edit.toString());
    }
  });
});

describe('chained mutation matrices (ADR-0198, M18.124)', () => {
  const parts = (n) => Array.from({ length: n }, (_, i) => ({ id: `p-${i + 1}` }));
  const ids = (chains) => chains.flat().map((p) => p.id);
  it('NFR-MNT-005: a plan within one matrix stays one chain; a larger one splits evenly, in order, dropping nothing', () => {
    assert.equal(MATRIX_JOBS_MAX, 256);
    assert.equal(MATRIX_CHAINS, 2);
    assert.deepEqual(
      matrixChains(parts(3)).map((c) => c.length),
      [3],
    );
    assert.deepEqual(
      matrixChains(parts(256)).map((c) => c.length),
      [256],
    );
    // the 274 partitions of nightly 40470089950 that one matrix refused
    const split = matrixChains(parts(274));
    assert.deepEqual(
      split.map((c) => c.length),
      [137, 137],
    );
    assert.deepEqual(ids(split), ids([parts(274)]));
    assert.deepEqual(
      matrixChains(parts(257)).map((c) => c.length),
      [129, 128],
    );
    assert.deepEqual(
      matrixChains(parts(512)).map((c) => c.length),
      [256, 256],
    );
  });
  it('NFR-MNT-005: a plan beyond every chained matrix fails instead of dropping a partition', () => {
    assert.throws(() => matrixChains(parts(513)), /needs 513 jobs, over 2 chained matrices of 256; no scope was dropped/);
    assert.throws(() => matrixChains(parts(5), 1, 4), /needs 5 jobs, over 1 chained matrices of 4/);
  });
});
