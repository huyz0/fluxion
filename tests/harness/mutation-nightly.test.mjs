// NFR-MNT-005: exercise real orchestration commands with an explicitly synthetic mutation engine.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { MATRIX_JOBS_MAX, partitionManifest } from '../../scripts/harness/mutation-partitions.mjs';
import { cleanEnv, out, REPO } from './helpers.mjs';
import { mutationFixture } from './mutation-fixture.mjs';

const collect = (sb) =>
  sb.node('scripts/ci/mutation-nightly.mjs', ['plan', '--out', 'reports/mutation-plan.json'], {
    env: { ...process.env, GITHUB_OUTPUT: sb.path('reports/outputs') },
  });
/** The plan step's GitHub outputs, by name. */
const outputs = (sb) =>
  Object.fromEntries(
    sb
      .read('reports/outputs')
      .trim()
      .split('\n')
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  );
function execute(sb) {
  const all = outputs(sb);
  // a plan within one matrix's 256 jobs runs one chained matrix (ADR-0198)
  assert.equal(all.chains, '1');
  assert.equal(all.matrix_2, undefined);
  const matrix = JSON.parse(all.matrix);
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

/** Run the real plan step on `source`'s HEAD plus its working tree's tracked changes and check the chained outputs (M18.137, M18.156). */
function assertChainedPlan(source) {
  const dir = mkdtempSync(join(tmpdir(), 'fluxion-plan-'));
  try {
    // the plan needs clean inputs, so it runs on a clone with the tree being committed committed in it,
    // sharing this checkout's dependencies (M18.156: HEAD alone would hide an uncommitted change)
    const clone = join(dir, 'repo');
    const git = (args, input) => {
      const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: cleanEnv(), input, maxBuffer: 1 << 30 }); // a tracked change can exceed 1 MiB
      assert.equal(r.status, 0, out(r));
      return r.stdout;
    };
    git(['clone', '-q', '--shared', '--no-checkout', source, clone]);
    git(['-C', clone, 'checkout', '-q', '--detach', 'HEAD']);
    const changes = git(['-C', source, 'diff', '--binary', 'HEAD']);
    if (changes) {
      git(['-C', clone, 'apply', '--index', '-'], changes);
      git([
        '-C',
        clone,
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'user.name=plan',
        '-c',
        'user.email=plan@example.invalid',
        'commit',
        '-q',
        '--no-verify',
        '-m',
        'tree being committed',
      ]);
    }
    symlinkSync(join(REPO, 'node_modules'), join(clone, 'node_modules'), 'junction');
    appendFileSync(join(clone, '.git', 'info', 'exclude'), 'node_modules\n');
    const r = spawnSync(process.execPath, [join(clone, 'scripts/ci/mutation-nightly.mjs'), 'plan', '--out', join(dir, 'plan.json')], {
      cwd: clone,
      encoding: 'utf8',
      env: { ...cleanEnv(), GITHUB_OUTPUT: join(dir, 'outputs') },
    });
    assert.equal(r.status, 0, out(r));
    const ids = partitionManifest(JSON.parse(readFileSync(join(dir, 'plan.json'), 'utf8'))).map((p) => p.id);
    // the repository's own plan is the two-chain case; if it ever fits one matrix, this test needs a larger fixture
    assert.ok(ids.length > MATRIX_JOBS_MAX, `the plan has ${ids.length} partitions, not over ${MATRIX_JOBS_MAX}`);
    const all = Object.fromEntries(
      readFileSync(join(dir, 'outputs'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
    );
    assert.deepEqual(Object.keys(all).sort(), ['chains', 'matrix', 'matrix_2']);
    assert.equal(all.chains, '2');
    const chains = [all.matrix, all.matrix_2].map((m) => JSON.parse(m).include.map((e) => e.id));
    for (const chain of chains) assert.ok(chain.length > 0 && chain.length <= MATRIX_JOBS_MAX, `${chain.length} jobs in one matrix`);
    const listed = chains.flat();
    assert.equal(new Set(listed).size, listed.length, 'no partition listed twice');
    assert.deepEqual([...listed].sort(), [...ids].sort(), 'every partition listed');
    assert.match(r.stdout, new RegExp(`${ids.length} complete partitions in 2 matrix job\\(s\\) \\(${chains[0].length} \\+ ${chains[1].length}\\)`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

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
  it('NFR-MNT-005: default matrix, CLI, programmatic runner and aggregate retain exhaustive 50/1 groups', () => {
    const sb = mutationFixture();
    try {
      for (let i = 0; i < 50; i++) sb.write(`packages/core/src/extra${i}.ts`, 'export const value = true;\n');
      sb.git('add', '.');
      assert.equal(sb.git('commit', '-qm', '51 core sources').status, 0);
      const collected = collect(sb);
      assert.equal(collected.status, 0, out(collected));
      const matrix = JSON.parse(outputs(sb).matrix);
      assert.deepEqual(
        matrix.include.map((x) => x.id),
        ['anim-1', 'core-1', 'core-2'],
      );
      execute(sb);
      const plan = JSON.parse(sb.read('reports/mutation-plan.json'));
      const ids = [];
      for (const { id } of matrix.include) {
        const report = JSON.parse(sb.read(`reports/parts/${id}/tzap.json`));
        assert.equal(report.mutants.length, id === 'core-1' ? 50 : 1);
        assert.deepEqual(report.tests, [{ id: 'node' }, { id: 'browser' }]);
        ids.push(...report.mutants.map((m) => m.id));
      }
      assert.deepEqual(ids.sort(), plan.mutants.map((m) => m.id).sort());
      assert.equal(new Set(ids).size, ids.length);
      sb.write(
        'reports/programmatic.mjs',
        `import {runPackage} from '../scripts/harness/mutate-shard.mjs';
process.exitCode = runPackage({manifestPath:'reports/mutation-plan.json',partitionId:'core-2',outDir:'reports/programmatic'});`,
      );
      const programmatic = sb.node('reports/programmatic.mjs');
      assert.equal(programmatic.status, 0, out(programmatic));
      assert.deepEqual(JSON.parse(sb.read('reports/programmatic/tzap.json')), JSON.parse(sb.read('reports/parts/core-2/tzap.json')));
      const done = aggregate(sb);
      assert.equal(done.status, 0, out(done));
      const shardPath = 'reports/parts/core-2/shard.json',
        good = sb.read(shardPath);
      sb.write(shardPath, good.replace('"partition": "core-2"', '"partition": "core-1"'));
      assert.notEqual(aggregate(sb).status, 0);
      sb.write(shardPath, good);
      rmSync(sb.path('reports/parts/core-2'), { recursive: true });
      assert.notEqual(aggregate(sb).status, 0);
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

  it('NFR-MNT-005: over 256 partitions, the real plan step writes matrix, matrix_2 and chains=2 covering every partition once (M18.137)', () => {
    assertChainedPlan(REPO);
  });

  it('NFR-MNT-005: an uncommitted change to the plan step that drops a partition from a matrix fails the chained-plan case (M18.156)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fluxion-plan-src-'));
    try {
      const source = join(dir, 'src');
      for (const args of [
        ['clone', '-q', '--shared', '--no-checkout', REPO, source],
        ['-C', source, 'checkout', '-q', '--detach', 'HEAD'],
      ]) {
        const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: cleanEnv() });
        assert.equal(r.status, 0, out(r));
      }
      const script = join(source, 'scripts/ci/mutation-nightly.mjs');
      const text = readFileSync(script, 'utf8');
      const dropped = text.replace('include: chain.map(', 'include: chain.slice(1).map(');
      assert.notEqual(dropped, text, 'the plan step no longer builds each matrix from chain.map');
      writeFileSync(script, dropped);
      assert.throws(() => assertChainedPlan(source), /every partition listed/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
