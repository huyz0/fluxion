// NFR-MNT-005: exercise the real collector/wrapper with a synthetic engine, never as mutation qualification.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import { out } from './helpers.mjs';
import { mutationFixture as fixture } from './mutation-fixture.mjs';

const plan = (sb, env = process.env) => sb.node('scripts/harness/mutation-plan.mjs', ['--out', 'reports/plan.json'], { env });
const execute = (sb, mode = '') =>
  sb.node('scripts/harness/mutate-shard.mjs', ['--manifest', 'reports/plan.json', '--package', 'packages/core', '--out-dir', 'reports/core'], {
    env: { ...process.env, FIXTURE_MUTATION_MODE: mode },
  });

describe('isolated mutation execution (NFR-MNT-005)', () => {
  it('inspection can read scope beside bookkeeping while execution still requires clean inputs', () => {
    const sb = fixture();
    try {
      sb.write('.harness/state.json', '{}');
      sb.write('reports/inspect.mjs', "import {inspectPlan} from '../scripts/harness/mutation-plan.mjs'; console.log(JSON.stringify(inspectPlan()));");
      const inspected = sb.node('reports/inspect.mjs');
      assert.equal(inspected.status, 0, out(inspected));
      assert.equal(JSON.parse(inspected.stdout).mutants.length, 2);
      assert.notEqual(plan(sb).status, 0);
    } finally {
      sb.cleanup();
    }
  });

  it('runs one complete source partition while preserving test projects and raw evidence', () => {
    const sb = fixture();
    try {
      sb.write('packages/core/src/other.ts', 'export const other = true;');
      sb.git('add', '.');
      assert.equal(sb.git('commit', '-qm', 'second source').status, 0);
      assert.equal(plan(sb).status, 0);
      const result = sb.node('scripts/harness/mutate-shard.mjs', [
        '--manifest',
        'reports/plan.json',
        '--partition',
        'core-1',
        '--target-mutants',
        '1',
        '--out-dir',
        'reports/part',
      ]);
      assert.equal(result.status, 0, out(result));
      const report = JSON.parse(sb.read('reports/part/shard.json'));
      assert.equal(report.partition, 'core-1');
      assert.equal(report.package, 'packages/core');
      assert.equal(report.report.mutants.length, 1);
      assert.deepEqual(report.report.tests, [{ id: 'node' }, { id: 'browser' }]);
      const model = JSON.parse(sb.read('reports/part/model.json'));
      assert.deepEqual(model.packages[0].sources, ['packages/core/src/other.ts']);
      const rejected = sb.node('scripts/harness/mutate.mjs', ['--package', 'packages/core', '--sources-file', 'reports/part/sources.json', '--check']);
      assert.notEqual(rejected.status, 0, out(rejected));
      assert.doesNotMatch(rejected.stdout, /FIXTURE_EXECUTED/);
    } finally {
      sb.cleanup();
    }
  });

  it('rejects invalid explicit sources before invoking the mutation engine', () => {
    const sb = fixture();
    try {
      for (const sources of [
        [],
        ['packages/anim/src/value.ts'],
        ['packages/core/src/../src/value.ts'],
        ['packages/core/src/*.ts'],
        ['packages/core/src/missing.ts'],
        ['packages/core/src/value.ts', 'packages/core/src/value.ts'],
        null,
      ]) {
        sb.write('reports/sources.json', JSON.stringify(sources));
        const result = sb.node('scripts/harness/mutate.mjs', ['--package', 'packages/core', '--sources-file', 'reports/sources.json']);
        assert.equal(result.status, 2, out(result));
        assert.doesNotMatch(result.stdout, /FIXTURE_EXECUTED/);
      }
    } finally {
      sb.cleanup();
    }
  });

  it('collects every pure package and retains full test scope in a fresh report', () => {
    const sb = fixture();
    try {
      const collected = plan(sb);
      assert.equal(collected.status, 0, out(collected));
      const manifest = JSON.parse(sb.read('reports/plan.json'));
      assert.deepEqual(manifest.packages, ['packages/anim', 'packages/core']);
      assert.deepEqual(manifest.floors, { 'packages/anim': 70, 'packages/core': 100 });
      assert.equal(manifest.mutants.length, 2);
      const result = execute(sb);
      assert.equal(result.status, 0, out(result));
      const shard = JSON.parse(sb.read('reports/core/shard.json'));
      assert.equal(shard.revision, manifest.revision);
      assert.equal(shard.exitCode, 0);
      assert.deepEqual(shard.report.tests, [{ id: 'node' }, { id: 'browser' }]);
      assert.deepEqual(shard.report.timings, { coverage: 1, execute: 2 });
      assert.ok(Number.isFinite(shard.elapsedMs) && shard.elapsedMs >= 0);
      assert.equal(shard.report.mutants.length, 1);
      assert.ok(sb.read('reports/core/tzap.json').includes('Killed'));
    } finally {
      sb.cleanup();
    }
  });

  it('failed execution remains failing despite a written passing report', () => {
    const sb = fixture();
    try {
      assert.equal(plan(sb).status, 0);
      const result = execute(sb, 'execution-failed');
      assert.notEqual(result.status, 0, out(result));
      assert.notEqual(JSON.parse(sb.read('reports/core/shard.json')).exitCode, 0);
      assert.ok(sb.read('reports/core/tzap.json').includes('Killed'));
    } finally {
      sb.cleanup();
    }
  });

  it('rejects a partial report that the old zero-valid score would accept', () => {
    const sb = fixture();
    try {
      assert.equal(plan(sb).status, 0);
      const result = execute(sb, 'partial');
      assert.notEqual(result.status, 0, out(result));
      assert.notEqual(JSON.parse(sb.read('reports/core/shard.json')).exitCode, 0);
    } finally {
      sb.cleanup();
    }
  });

  it('rejects stale revisions, changed sources and untracked execution inputs before running', () => {
    for (const change of [
      (sb) => {
        sb.write('packages/core/src/value.ts', 'export const value = false;\n');
      },
      (sb) => {
        sb.write('packages/core/src/new.ts', 'export const another = true;\n');
      },
      (sb) => {
        sb.write('README.md', 'new revision\n');
        sb.git('add', 'README.md');
        sb.git('commit', '-qm', 'next fixture');
      },
      (sb) => {
        const p = JSON.parse(sb.read('reports/plan.json'));
        p.floors['packages/core'] = 70;
        sb.write('reports/plan.json', JSON.stringify(p));
      },
    ]) {
      const sb = fixture();
      try {
        assert.equal(plan(sb).status, 0);
        sb.write('reports/core/shard.json', JSON.stringify({ exitCode: 0, stale: true }));
        change(sb);
        const result = execute(sb);
        assert.notEqual(result.status, 0, out(result));
        assert.doesNotMatch(result.stdout, /FIXTURE_EXECUTED/);
        const failed = JSON.parse(sb.read('reports/core/shard.json'));
        assert.notEqual(failed.exitCode, 0);
        assert.equal(failed.stale, undefined);
      } finally {
        sb.cleanup();
      }
    }
  });

  it('rejects changed property-test settings before executing a shard', () => {
    const sb = fixture();
    try {
      assert.equal(plan(sb).status, 0);
      const result = sb.node(
        'scripts/harness/mutate-shard.mjs',
        ['--manifest', 'reports/plan.json', '--package', 'packages/core', '--out-dir', 'reports/core'],
        { env: { ...process.env, FC_RUNS: process.env.FC_RUNS === '987' ? '988' : '987' } },
      );
      assert.notEqual(result.status, 0, out(result));
      assert.doesNotMatch(result.stdout, /FIXTURE_EXECUTED/);
    } finally {
      sb.cleanup();
    }
  });

  it('rejects a checkout changed while its inventory is being collected', () => {
    const sb = fixture();
    try {
      const result = plan(sb, { ...process.env, FIXTURE_MUTATION_MODE: 'change-during-inventory' });
      assert.notEqual(result.status, 0, out(result));
      assert.equal(existsSync(sb.path('reports/plan.json')), false);
    } finally {
      sb.cleanup();
    }
  });

  it('failed inventory generation is not accepted even if it prints valid JSON', () => {
    const sb = fixture();
    try {
      sb.write('reports/plan.json', JSON.stringify({ stale: true }));
      const result = plan(sb, { ...process.env, FIXTURE_MUTATION_MODE: 'inventory-failed' });
      assert.notEqual(result.status, 0, out(result));
      assert.match(result.stderr, /list-mutants.*exited 3/);
      assert.equal(existsSync(sb.path('reports/plan.json')), false);
    } finally {
      sb.cleanup();
    }
  });
});
