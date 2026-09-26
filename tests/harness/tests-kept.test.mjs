// NFR-DX-004 / non-negotiable 2: deleting or disabling tests needs an explicit, reviewed reason.
import assert from 'node:assert/strict';
import { chmodSync } from 'node:fs';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { out, sandbox } from './helpers.mjs';

const SUITE = "import { it } from 'vitest';\nit('FR-X-001: one', () => {});\nit('FR-X-002: two', () => {});\n";
// Built indirectly so this file itself does not trip check-tests-kept.
const SKIP = ['it', 'skip'].join('.');
const ONLY = ['it', 'only'].join('.');
let sb;

function check(message = 'M0.7: test: change') {
  sb.write('.git-msg', message);
  return sb.node('scripts/gates/check-tests-kept.mjs', ['--msg', sb.path('.git-msg')]);
}

describe('check-tests-kept (NFR-DX-004)', () => {
  beforeEach(() => {
    sb = sandbox(['scripts'], { git: true });
    sb.write('packages/core/src/a.test.ts', SUITE);
    sb.write('packages/core/src/a.ts', 'export const a = 1;\n');
    sb.git('add', '-A');
    sb.git('commit', '-q', '-m', 'fixture', '--no-verify');
  });
  afterEach(() => sb.cleanup());

  it('passes when no test is touched', () => {
    sb.write('packages/core/src/a.ts', 'export const a = 2;\n');
    sb.git('add', '-A');
    assert.equal(check().status, 0);
  });

  it('passes when test cases are added', () => {
    sb.write('packages/core/src/a.test.ts', `${SUITE}it('FR-X-003: three', () => {});\n`);
    sb.git('add', '-A');
    assert.equal(check().status, 0);
  });

  it('passes when a test file is renamed to another test file', () => {
    sb.git('mv', 'packages/core/src/a.test.ts', 'packages/core/src/b.test.ts');
    assert.equal(check().status, 0);
  });

  const bad = {
    'deleting a test file': () => sb.git('rm', '-q', 'packages/core/src/a.test.ts'),
    'removing a test case': () => {
      sb.write('packages/core/src/a.test.ts', SUITE.replace("it('FR-X-002: two', () => {});\n", ''));
      sb.git('add', '-A');
    },
    'skipping a test case': () => {
      sb.write('packages/core/src/a.test.ts', SUITE.replace("it('FR-X-002", `${SKIP}('FR-X-002`));
      sb.git('add', '-A');
    },
    'focusing a test case with .only': () => {
      sb.write('packages/core/src/a.test.ts', SUITE.replace("it('FR-X-001", `${ONLY}('FR-X-001`));
      sb.git('add', '-A');
    },
    'adding a new skipped case': () => {
      sb.write('packages/core/src/a.test.ts', `${SUITE}${SKIP}('FR-X-003: later', () => {});\n`);
      sb.git('add', '-A');
    },
    'renaming a test file to a non-test name':() => sb.git('mv', 'packages/core/src/a.test.ts', 'packages/core/src/a.old.ts'),
  };
  for (const [name, act] of Object.entries(bad)) {
    it(`fails on ${name} without a trailer`, () => {
      act();
      const r = check();
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, /tests-kept:/);
    });
    it(`passes on ${name} with a Removes-test trailer`, () => {
      act();
      const r = check('M0.7: test: drop obsolete case\n\nRemoves-test: covered by FR-X-004 suite\n');
      assert.equal(r.status, 0, out(r));
    });
  }

  it('the tracked commit-msg hook enforces it on a real commit', () => {
    sb.write('.githooks/commit-msg', sb.readRepo('.githooks/commit-msg'));
    chmodSync(sb.path('.githooks/commit-msg'), 0o755);
    sb.write('docs/backlog/current.md', '| M0.7 | t | x | x | — | doing | |\n');
    sb.git('config', 'core.hooksPath', '.githooks');
    sb.git('rm', '-q', 'packages/core/src/a.test.ts');
    const refused = sb.git('commit', '-q', '-m', 'M0.7: test: drop suite');
    assert.notEqual(refused.status, 0, out(refused));
    const ok = sb.git('commit', '-q', '-m', 'M0.7: test: drop suite', '-m', 'Removes-test: superseded');
    assert.equal(ok.status, 0, out(ok));
  });

  it('an empty Removes-test trailer does not count', () => {
    sb.git('rm', '-q', 'packages/core/src/a.test.ts');
    assert.equal(check('M0.7: test: x\n\nRemoves-test:\n').status, 1);
  });

  it('an empty Removes-test trailer followed by another trailer does not count', () => {
    sb.git('rm', '-q', 'packages/core/src/a.test.ts');
    const r = check('M0.7: test: x\n\nRemoves-test:\nCo-Authored-By: Agent <a@example.invalid>\n');
    assert.equal(r.status, 1, out(r));
  });

  it('does not count method calls such as regex .test() as test cases', () => {
    sb.write('packages/core/src/a.test.ts', SUITE.replace("it('FR-X-002: two', () => {});\n", "assert.ok(/a/.test('a'));\n"));
    sb.git('add', '-A');
    const r = check();
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /removes 1 test case/);
  });
});
