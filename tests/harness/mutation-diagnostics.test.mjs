// Synthetic engines exercise real orchestration; these tests never qualify mutation scores.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import { validateMutationEvidence } from '../../scripts/ci/mutation-evidence.mjs';
import { mutationDiagnostic } from '../../scripts/harness/mutation-diagnostics.mjs';
import { out } from './helpers.mjs';
import { mutationFixture } from './mutation-fixture.mjs';

const env = { ...process.env, GITHUB_ACTIONS: 'true' };
const annotations = (result) => result.stdout.split('\n').filter((line) => /^::(?:notice|error)::/.test(line));
const decode = (line) =>
  line
    .replace(/^::(?:notice|error)::/, '')
    .replaceAll('%0D', '\r')
    .replaceAll('%0A', '\n')
    .replaceAll('%25', '%');
const collect = (sb, extra = {}) => sb.node('scripts/harness/mutation-plan.mjs', ['--out', 'reports/plan.json'], { env: { ...env, ...extra } });
const execute = (sb, mode = '', extra = {}) =>
  sb.node('scripts/harness/mutate-shard.mjs', ['--manifest', 'reports/plan.json', '--partition', 'core-1', '--out-dir', 'reports/part'], {
    env: { ...env, FIXTURE_MUTATION_MODE: mode, ...extra },
  });

describe('mutation partition diagnostics (NFR-MNT-005, NFR-DX-003)', () => {
  it('WHEN a complete partition has survivors or uncovered mutants THEN exposes identities without claiming qualification', () => {
    for (const [mode, status] of [
      ['survived', 'Survived'],
      ['uncovered', 'NoCoverage'],
    ]) {
      const sb = mutationFixture();
      try {
        assert.equal(collect(sb).status, 0);
        const result = execute(sb, mode);
        assert.equal(result.status, 0, out(result));
        const lines = annotations(result);
        assert.equal(lines.length, 1, out(result));
        const message = decode(lines[0]);
        assert.match(message, /partial.*not qualification/);
        assert.match(message, /core-1/);
        assert.match(message, new RegExp(`${status}: 1`));
        assert.match(message, /packages\/core\/src\/value\.ts.*1:1/);
        const shard = JSON.parse(sb.read('reports/part/shard.json'));
        assert.equal(shard.exitCode, 0);
        assert.equal(shard.report.mutants[0].status, status);
        assert.deepEqual(shard.report.tests, [{ id: 'node' }, { id: 'browser' }]);
        assert.deepEqual(JSON.parse(sb.read('reports/part/tzap.json')), shard.report);
        const plan = JSON.parse(sb.read('reports/plan.json'));
        const verdict = validateMutationEvidence(
          {
            run: { id: 1, name: 'nightly', head_sha: plan.revision, status: 'completed', run_attempt: 1, path: '.github/workflows/nightly.yml' },
            jobs: [],
            annotations: [{ annotation_level: 'notice', message }],
          },
          plan,
          plan.revision,
        );
        assert.equal(verdict.ok, false);
        assert.match(verdict.errors.join(), /missing.*mutation evidence notice/);
      } finally {
        sb.cleanup();
      }
    }
  });

  it('WHEN execution or report validation fails THEN annotates the error and preserves failed status and raw evidence', () => {
    for (const [mode, reason] of [
      ['execution-failed', /fixture mutation execution failed/],
      ['partial', /incomplete or changed mutant inventory/],
      ['malformed', /JSON/],
    ]) {
      const sb = mutationFixture();
      try {
        assert.equal(collect(sb).status, 0);
        const result = execute(sb, mode);
        assert.equal(result.status, mode === 'execution-failed' ? 3 : 1, out(result));
        const lines = annotations(result);
        assert.equal(lines.length, 1, out(result));
        assert.ok(lines[0].startsWith('::error::'));
        assert.match(decode(lines[0]), reason);
        assert.doesNotMatch(decode(lines[0]), /Counts:/);
        assert.ok(existsSync(sb.path('reports/part/tzap.json')));
        assert.notEqual(JSON.parse(sb.read('reports/part/shard.json')).exitCode, 0);
        assert.match(result.stdout, /FIXTURE_EXECUTED/);
        if (mode === 'execution-failed') assert.match(result.stderr, /fixture mutation execution failed/);
      } finally {
        sb.cleanup();
      }
    }
  });

  it('WHEN inventory changes before execution THEN reports rejection without running the engine', () => {
    const sb = mutationFixture();
    try {
      assert.equal(collect(sb).status, 0);
      sb.write('packages/core/src/value.ts', 'export const value = false;');
      const result = execute(sb);
      assert.notEqual(result.status, 0);
      assert.doesNotMatch(result.stdout, /FIXTURE_EXECUTED/);
      assert.equal(annotations(result).length, 1, out(result));
      assert.match(decode(annotations(result)[0]), /dirty|changed|clean|inventory/);
    } finally {
      sb.cleanup();
    }
  });

  it('WHEN CLI usage or output setup fails THEN annotates the failure while retaining exit codes', () => {
    const sb = mutationFixture();
    try {
      const usage = sb.node('scripts/harness/mutate-shard.mjs', [], { env });
      assert.equal(usage.status, 2);
      assert.equal(annotations(usage).length, 1, out(usage));
      assert.match(decode(annotations(usage)[0]), /usage:/);
      sb.write('reports/part', 'a file cannot be an output directory');
      const result = execute(sb);
      assert.equal(result.status, 1);
      assert.equal(annotations(result).length, 1, out(result));
      assert.match(decode(annotations(result)[0]), /EEXIST|ENOTDIR/);
    } finally {
      sb.cleanup();
    }
  });

  it('WHEN validated identities contain workflow commands THEN escapes one annotation and retains exact raw IDs', () => {
    const sb = mutationFixture();
    const payload = 'id%0A\r\n::error::injected\u001b[31m';
    const extra = { FIXTURE_MUTATION_ID: payload };
    try {
      const collected = collect(sb, extra);
      assert.equal(collected.status, 0, out(collected));
      const result = execute(sb, 'survived', extra);
      assert.equal(result.status, 0, out(result));
      const lines = annotations(result);
      assert.equal(lines.length, 1, out(result));
      assert.match(lines[0], /id%250A%0D%0A::error::injected/);
      assert.doesNotMatch(lines[0], /[\r\n]/);
      assert.equal(lines[0].includes('\u001b'), false);
      assert.equal(JSON.parse(sb.read('reports/part/tzap.json')).mutants[0].id, `${payload}packages/core/src/value.ts`);
      const local = execute(sb, 'survived', { ...extra, GITHUB_ACTIONS: 'false' });
      assert.equal(local.status, 0, out(local));
      assert.deepEqual(annotations(local), []);
    } finally {
      sb.cleanup();
    }
  });

  it('WHEN no mutants need reporting THEN emits explicit empty counts without a score', () => {
    const message = decode(mutationDiagnostic({ label: 'empty', mutants: [] }));
    assert.match(message, /Counts: none/);
    assert.match(message, /not qualification/);
    assert.doesNotMatch(message, /100\s*%/);
  });

  it('WHEN diagnostics exceed bounds THEN marks omitted detail and keeps escaped commands within one bounded line', () => {
    const mutant = { id: 'id', file: 'packages/core/src/a.ts', status: 'Survived', location: { start: { line: 3, column: 2 } } };
    const many = mutationDiagnostic({ label: 'core-1', mutants: Array.from({ length: 100 }, (_, id) => ({ ...mutant, id: String(id) })) });
    assert.match(decode(many), /Survived: 100/);
    assert.equal((decode(many).match(/ — packages\/core\/src\/a.ts:3:2/g) ?? []).length, 25);
    assert.match(decode(many), /75 more problem mutants/);
    for (const input of [
      { label: 'core-1', error: '%\r\n::error::injected'.repeat(4000) },
      { label: 'core-1', mutants: [{ ...mutant, id: '💥%\r\n'.repeat(10000) }] },
    ]) {
      const line = mutationDiagnostic(input);
      assert.ok(Buffer.byteLength(line) < 64000);
      assert.doesNotMatch(line, /[\r\n]/);
      assert.match(decode(line), /diagnostic truncated/);
    }
  });
});
