// NFR-MNT-005: a red baseline test fails its mutation shard and leaves its whole failure output in the job log (M18.286).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RED_TEST_LINES, redTestLines } from '../../scripts/harness/mutate-shard.mjs';
import { out } from './helpers.mjs';
import { mutationFixture } from './mutation-fixture.mjs';

/** A node:test file's failure as tzap records it: the TAP stream, whose first line says nothing. */
const TAP = [
  'TAP version 13',
  '# Subtest: svg witness',
  'not ok 1 - svg witness',
  '  ---',
  "  error: 'Expected values to be strictly equal'",
  '  stack: |-',
  '    at TestContext.<anonymous> (file:///packages/dsl/src/witness.test.ts:12:5)',
  '  ...',
  '# fail 1',
].join('\n');

describe('a red baseline in a mutation shard (NFR-MNT-005, M18.286)', () => {
  it('prints each red test id and its failure output to the log, and the shard still fails', () => {
    const sb = mutationFixture();
    try {
      // the fixture engine reports this red test; node_modules is outside the fixture's clean-checkout inputs
      const engine = 'node_modules/@huyz0/tzap/dist/bin.js';
      const red = JSON.stringify([{ id: 'dsl:witness', name: 'svg witness', file: 'packages/dsl/src/witness.test.ts', message: TAP }]);
      sb.write(engine, sb.read(engine).replace('redTests:[]', `redTests:${red}`));
      assert.equal(sb.node('scripts/harness/mutation-plan.mjs', ['--out', 'reports/plan.json']).status, 0);
      const r = sb.node('scripts/harness/mutate-shard.mjs', ['--manifest', 'reports/plan.json', '--package', 'packages/core', '--out-dir', 'reports/core']);
      assert.notEqual(r.status, 0, out(r));
      assert.match(r.stderr, /baseline test failed with no mutant applied: dsl:witness \(svg witness, packages\/dsl\/src\/witness\.test\.ts\)/);
      // the last line of the failure, and the assertion with its stack, not only "TAP version 13"
      assert.match(r.stderr, /^ {2}# fail 1$/m);
      assert.match(r.stderr, /witness\.test\.ts:12:5/);
      assert.match(r.stderr, /failed baseline tests/);
      assert.equal(JSON.parse(sb.read('reports/core/shard.json')).exitCode, 1);
    } finally {
      sb.cleanup();
    }
  });

  it('keeps the last RED_TEST_LINES lines of a long failure and says how many came before', () => {
    const message = Array.from({ length: RED_TEST_LINES + 50 }, (_, i) => `line ${i + 1}`).join('\n');
    const lines = redTestLines({ redTests: [{ id: 'a', message }, { id: 'b' }] });
    assert.equal(lines[0], 'mutation shard: baseline test failed with no mutant applied: a');
    assert.equal(lines[1], `  [50 earlier lines; last ${RED_TEST_LINES} follow]`);
    assert.equal(lines[2], '  line 51');
    assert.equal(lines[RED_TEST_LINES + 1], `  line ${RED_TEST_LINES + 50}`);
    assert.deepEqual(lines.slice(RED_TEST_LINES + 2), [
      'mutation shard: baseline test failed with no mutant applied: b',
      '  (the report holds no failure output for it)',
    ]);
    assert.deepEqual(redTestLines({ redTests: [] }), []);
    assert.deepEqual(redTestLines(undefined), []);
  });
});
