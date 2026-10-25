// NFR-MNT-005: complete package reports are required before a mutation score can qualify.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { aggregateShards, createManifest } from '../../scripts/harness/mutation-shards.mjs';

const revision = 'a'.repeat(40);
const runner = 'b'.repeat(64);
const file = (pkg) => `${pkg}/src/value.ts`;
const mutant = (pkg, id) => ({
  id,
  file: file(pkg),
  mutatorName: 'BooleanLiteral',
  location: { start: { line: 1, column: 1 }, end: { line: 1, column: 5 } },
  original: 'true',
  replacement: 'false',
});
const packages = ['packages/core', 'packages/anim'];

function fixture() {
  const mutants = packages.map((pkg, i) => mutant(pkg, String(i)));
  const files = Object.fromEntries(packages.map((pkg) => [file(pkg), 'c'.repeat(64)]));
  const manifest = createManifest({ revision, runner, version: '0.1.1', packages, files, mutants, floors: { 'packages/core': { score: 100 } } });
  const shards = packages.map((pkg, i) => ({
    schemaVersion: 1,
    revision,
    runner,
    package: pkg,
    exitCode: 0,
    files: { [file(pkg)]: files[file(pkg)] },
    report: {
      schemaVersion: 1,
      tzapVersion: '0.1.1',
      config: { scope: 'full', mutators: ['all'] },
      redTests: [],
      tests: [{ id: 'test' }],
      mutants: [{ ...mutants[i], status: 'Killed' }],
    },
  }));
  return { manifest, shards, files, mutants };
}

describe('mutation shard completeness (NFR-MNT-005)', () => {
  it('all sources and floors preserved before scores qualify', () => {
    const { manifest, shards } = fixture();
    const result = aggregateShards(manifest, shards);
    assert.equal(result.ok, true, result.errors.join('\n'));
    assert.deepEqual(
      result.scores.map((s) => [s.package, s.floor, s.score, s.valid]),
      [
        ['packages/anim', 70, 100, 1],
        ['packages/core', 100, 100, 1],
      ],
    );
    shards[0].report.mutants[0].status = 'Survived';
    assert.equal(aggregateShards(manifest, shards).ok, false);
  });

  it('missing shard fails, including an empty report set', () => {
    const { manifest, shards } = fixture();
    assert.equal(aggregateShards(manifest, shards.slice(1)).ok, false);
    assert.equal(aggregateShards(manifest, []).ok, false);
  });

  it('failed shard fails even with apparently passing mutants', () => {
    for (const exitCode of [1, 3, null, '0']) {
      const { manifest, shards } = fixture();
      shards[0].exitCode = exitCode;
      assert.equal(aggregateShards(manifest, shards).ok, false);
    }
  });

  it('rejects duplicate, unexpected, stale and malformed shards', () => {
    for (const change of [
      (s) => s.push(s[0]),
      (s) => {
        s[0].package = 'packages/extra';
      },
      (s) => {
        s[0].revision = 'd'.repeat(40);
      },
      (s) => {
        s[0].runner = 'd'.repeat(64);
      },
      (s) => {
        s[0].schemaVersion = 2;
      },
      (s) => {
        s[0] = null;
      },
    ]) {
      const { manifest, shards } = fixture();
      change(shards);
      assert.equal(aggregateShards(manifest, shards).ok, false);
    }
  });

  it('rejects missing, changed and additional source evidence', () => {
    for (const change of [
      (s) => {
        s.files = {};
      },
      (s) => {
        s.files[file(packages[0])] = 'e'.repeat(64);
      },
      (s) => {
        s.files['packages/core/src/unexpected.ts'] = 'c'.repeat(64);
      },
    ]) {
      const { manifest, shards } = fixture();
      change(shards[0]);
      assert.equal(aggregateShards(manifest, shards).ok, false);
    }
  });

  it('rejects partial, duplicate, foreign and altered mutant inventories', () => {
    for (const change of [
      (m) => m.pop(),
      (m) => m.push(m[0]),
      (m) => {
        m[0].id = 'foreign';
      },
      (m) => {
        m[0].replacement = 'true';
      },
      (m) => {
        m[0].file = file(packages[1]);
      },
    ]) {
      const { manifest, shards } = fixture();
      change(shards[0].report.mutants);
      assert.equal(aggregateShards(manifest, shards).ok, false);
    }
  });

  it('rejects incomplete analysis and reduced execution scope', () => {
    for (const change of [
      (r) => {
        r.mutants[0].status = 'Pending';
      },
      (r) => {
        r.tests = [];
      },
      (r) => {
        r.redTests = ['failed baseline'];
      },
      (r) => {
        r.config.scope = 'diff';
      },
      (r) => {
        r.config.mutators = ['BooleanLiteral'];
      },
      (r) => {
        r.tzapVersion = 'other';
      },
      (r) => {
        r.mutants = null;
      },
      (r) => {
        r.schemaVersion = 2;
      },
    ]) {
      const { manifest, shards } = fixture();
      change(shards[0].report);
      assert.equal(aggregateShards(manifest, shards).ok, false);
    }
  });

  it('rejects malformed executed-test evidence', () => {
    for (const tests of [[null], [{}], [{ id: '' }]]) {
      const { manifest, shards } = fixture();
      shards[0].report.tests = tests;
      assert.equal(aggregateShards(manifest, shards).ok, false);
    }
  });

  it('retains timeout detection and invalid-mutant scoring without treating no valid mutants as success', () => {
    const { manifest, shards } = fixture();
    shards[0].report.mutants[0].status = 'Timeout';
    assert.equal(aggregateShards(manifest, shards).ok, true);
    for (const status of ['CompileError', 'RuntimeError', 'Ignored', 'NoCoverage']) {
      shards[0].report.mutants[0].status = status;
      assert.equal(aggregateShards(manifest, shards).ok, false, status);
    }
  });

  it('rejects malformed manifests instead of deriving expected scope from supplied reports', () => {
    const { manifest, shards } = fixture();
    for (const bad of [null, {}, { ...manifest, packages: [] }, { ...manifest, revision: 'bad' }]) {
      assert.equal(aggregateShards(bad, shards).ok, false);
    }
    const { files, mutants } = fixture();
    for (const extra of [
      { packages: [] },
      { mutants: [...mutants, mutants[0]] },
      { files: {} },
      { floors: { 'packages/core': { score: NaN } } },
      { floors: { 'packages/core': { score: null } } },
      { floors: { 'packages/core': {} } },
    ]) {
      assert.throws(() => createManifest({ revision, runner, version: '0.1.1', packages, files, mutants, floors: {}, ...extra }));
    }
  });
});
