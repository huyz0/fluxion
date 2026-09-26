// NFR-DX-003 / non-negotiable 1: commit subjects name a backlog task and a conventional type.
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { out, sandbox } from './helpers.mjs';

const sb = sandbox();
after(() => sb.cleanup());

function check(message) {
  sb.write('.git-msg', message);
  return sb.node('scripts/gates/check-commit-msg.mjs', [sb.path('.git-msg')]);
}

describe('check-commit-msg (NFR-DX-003)', () => {
  it('accepts "<TaskID>: <type>(<scope>): <summary>" for a task in the backlog', () => {
    const r = check('M0.3: test(harness): add commit-msg negative tests\n\nbody\n');
    assert.equal(r.status, 0, out(r));
  });

  it('accepts a subject without scope', () => {
    const r = check('M0.3: test: add tests');
    assert.equal(r.status, 0, out(r));
  });

  const bad = {
    'missing task id': 'feat(core): add store',
    'unknown task id': 'M9.999: feat(core): add store',
    'wrong type': 'M0.3: feature(core): add store',
    'missing summary': 'M0.3: feat(core): ',
    'uppercase scope': 'M0.3: feat(Core): add store',
    'empty Removes-test trailer': 'M0.3: test(harness): drop case\n\nRemoves-test:\n',
    'empty Threshold-change trailer': 'M0.3: chore(gates): tune\n\nThreshold-change:\n',
  };
  for (const [name, msg] of Object.entries(bad)) {
    it(`rejects ${name}`, () => {
      const r = check(msg);
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, /commit-msg:/);
    });
  }

  it('lets git-generated merge and revert subjects through', () => {
    assert.equal(check('Merge branch agent/M1-x').status, 0);
    assert.equal(check('Revert "M0.3: test: add tests"').status, 0);
  });

  it('finds task ids in archived backlogs', () => {
    sb.write('docs/backlog/archive/M9.md', '| M9.1 | old task | x | x | — | done | |\n');
    assert.equal(check('M9.1: fix(core): follow-up correction').status, 0);
  });

  it('exits 2 without a message file argument', () => {
    const r = sb.node('scripts/gates/check-commit-msg.mjs');
    assert.equal(r.status, 2, out(r));
  });
});
