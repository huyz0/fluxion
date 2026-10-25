// NFR-MNT-005: exercise real orchestration commands with an explicitly synthetic mutation engine.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import { out } from './helpers.mjs';
import { mutationFixture } from './mutation-fixture.mjs';

const collect = (sb) =>
  sb.node('scripts/ci/mutation-nightly.mjs', ['plan', '--out', 'reports/mutation-plan.json'], {
    env: { ...process.env, GITHUB_OUTPUT: sb.path('reports/outputs') },
  });
function execute(sb) {
  const matrix = JSON.parse(sb.read('reports/outputs').trim().slice('matrix='.length));
  for (const { id } of matrix.include) {
    const r = sb.node('scripts/harness/mutate-shard.mjs', ['--manifest', 'reports/mutation-plan.json', '--partition', id, '--out-dir', `reports/parts/${id}`]);
    assert.equal(r.status, 0, out(r));
  }
  return matrix;
}
const aggregate = (sb) =>
  sb.node(
    'scripts/ci/mutation-nightly.mjs',
    ['aggregate', '--manifest', 'reports/mutation-plan.json', '--reports', 'reports/parts', '--out', 'reports/evidence.json'],
    { env: { ...process.env, GITHUB_ACTIONS: 'true' } },
  );

describe('nightly mutation orchestration (NFR-MNT-005)', () => {
  it('plans all packages, retains raw reports and emits one complete evidence notice', () => {
    const sb = mutationFixture();
    try {
      const result = collect(sb);
      assert.equal(result.status, 0, out(result));
      const matrix = execute(sb);
      assert.deepEqual(
        matrix.include.map((x) => x.id),
        ['anim-1', 'core-1'],
      );
      const done = aggregate(sb);
      assert.equal(done.status, 0, out(done));
      assert.equal(done.stdout.split('\n').filter((l) => l.startsWith('::notice::FLUXION_MUTATION_EVIDENCE ')).length, 1);
      const receipt = JSON.parse(sb.read('reports/evidence.json'));
      assert.equal(receipt.scores.length, 2);
      assert.ok(existsSync(sb.path('reports/parts/core-1/tzap.json')));
    } finally {
      sb.cleanup();
    }
  });
  it('missing or failed reports overwrite stale success and expose failing annotations', () => {
    const sb = mutationFixture();
    try {
      assert.equal(collect(sb).status, 0);
      execute(sb);
      const path = 'reports/parts/core-1/shard.json',
        good = JSON.parse(sb.read(path));
      for (const bad of [
        { ...good, exitCode: 3 },
        { ...good, report: { ...good.report, mutants: [] } },
      ]) {
        sb.write(path, JSON.stringify(bad));
        sb.write('reports/evidence.json', JSON.stringify({ ok: true, stale: true }));
        const result = aggregate(sb);
        assert.notEqual(result.status, 0, out(result));
        assert.match(result.stdout, /^::error::/m);
        assert.doesNotMatch(result.stdout, /^::notice::FLUXION_MUTATION_EVIDENCE /m);
        assert.equal(JSON.parse(sb.read('reports/evidence.json')).ok, false);
      }
    } finally {
      sb.cleanup();
    }
  });
  it('does not accept a manifest for another checkout or leave a stale plan after failed collection', () => {
    const sb = mutationFixture();
    try {
      assert.equal(collect(sb).status, 0);
      execute(sb);
      const plan = JSON.parse(sb.read('reports/mutation-plan.json'));
      plan.runner = 'c'.repeat(64);
      sb.write('reports/mutation-plan.json', JSON.stringify(plan));
      assert.notEqual(aggregate(sb).status, 0);
      sb.write('packages/core/src/value.ts', 'export const value = false;');
      assert.notEqual(collect(sb).status, 0);
      assert.equal(existsSync(sb.path('reports/mutation-plan.json')), false);
    } finally {
      sb.cleanup();
    }
  });
});
