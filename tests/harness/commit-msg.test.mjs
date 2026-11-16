// NFR-DX-003 / non-negotiable 1: commit subjects name a backlog task and a conventional type.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { after, describe, it } from 'node:test';
import { cleanEnv, out, sandbox } from './helpers.mjs';

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

// M19.53, cp6 F3: a body that carries a review minor to a row changes that row in the same commit
describe('check-commit-msg: carried review minors change their row (M19.53)', () => {
  const g = sandbox(undefined, { git: true });
  after(() => g.cleanup());
  const SUBJECT = 'M19.53: fix(harness): something';
  const check = (body, args = []) => {
    g.write('.git-msg', `${SUBJECT}\n\n${body}\n`);
    return g.node('scripts/gates/check-commit-msg.mjs', [g.path('.git-msg'), ...args]);
  };
  /** Stage the backlog with `fn` applied, from the committed one. */
  const stageBacklog = (fn) => {
    g.git('reset', '-q');
    g.git('checkout', '-q', '--', 'docs/backlog/current.md');
    g.edit('docs/backlog/current.md', fn);
    g.git('add', 'docs/backlog/current.md');
  };
  const amendRow = (id) => (text) => text.replace(new RegExp(`^(\\| ${id.replace('.', '\\.')} \\| [^|]*)\\|`, 'm'), '$1 (amended) |');
  const addRow = (text) => text.replace(/^(\| M19\.53 \|.*)$/m, '$1\n| M19.99 | a new row | HARNESS | x | M19.53 | todo | |');

  it('NFR-DX-003: "carried to" a row passes when the staged backlog changes that row, and fails when it does not', () => {
    stageBacklog(amendRow('M19.52'));
    assert.equal(check('Review: r1 pass, 1 minor carried to M19.52.').status, 0);
    // the wording broken over two lines is the same claim
    assert.equal(check('Review: r1 pass, 1 minor carried\nto M19.52.').status, 0);
    const r = check('Review: r1 pass, 2 minors carried to M19.52 and one carried to M19.42.');
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /carries a review minor to M19\.42/);
    stageBacklog((text) => text);
    const none = check('Review: r1 pass, 1 minor carried to\nM19.52.');
    assert.equal(none.status, 1, out(none));
    assert.match(none.stderr, /does not change that row/);
  });

  it('NFR-DX-003: "becomes a backlog row" passes only when the staged backlog adds a row, not when it changes one', () => {
    stageBacklog(addRow);
    assert.equal(check('r1 minor (x) becomes a backlog row.').status, 0);
    stageBacklog(amendRow('M19.52'));
    const changed = check('r1 minor (x) becomes a backlog row with the next commit.');
    assert.equal(changed.status, 1, out(changed));
    assert.match(changed.stderr, /adds none/);
    stageBacklog((text) => text);
    assert.equal(check('r1 minor (x) becomes a backlog row.').status, 1);
    // a body that carries nothing reads no diff
    assert.equal(check('Review: r1 pass, no findings.').status, 0);
  });

  it("NFR-DX-003: with --commit the rule reads that commit's own backlog diff (check-commits in CI)", () => {
    stageBacklog(addRow);
    g.git('commit', '-q', '-m', 'add row', '--no-verify');
    const sha = g.git('rev-parse', 'HEAD').stdout.trim();
    g.git('reset', '-q');
    assert.equal(check('r1 minor becomes a backlog row.', ['--commit', sha]).status, 0);
    assert.equal(check('1 minor carried to M19.99.', ['--commit', sha]).status, 0);
    const r = check('1 minor carried to M19.52.', ['--commit', sha]);
    assert.equal(r.status, 1, out(r));
    // a commit made before the rule came in (at or before 43736e3) is exempt, as CI re-checks old history (r1 F1)
    g.write('old.txt', 'x');
    g.git('add', 'old.txt');
    spawnSync('git', ['commit', '-q', '-m', 'old', '--no-verify'], {
      cwd: g.dir,
      env: { ...cleanEnv(), GIT_COMMITTER_DATE: '2026-11-16T05:17:31Z', GIT_AUTHOR_DATE: '2026-11-16T05:17:31Z' },
    });
    const old = g.git('rev-parse', 'HEAD').stdout.trim();
    assert.equal(check('1 minor carried to M19.52.', ['--commit', old]).status, 0);
    // one second later the rule applies
    spawnSync('git', ['commit', '-q', '--amend', '-m', 'new', '--no-verify'], {
      cwd: g.dir,
      env: { ...cleanEnv(), GIT_COMMITTER_DATE: '2026-11-16T05:17:32Z' },
    });
    assert.equal(check('1 minor carried to M19.52.', ['--commit', g.git('rev-parse', 'HEAD').stdout.trim()]).status, 1);
  });

  it("NFR-DX-003: an amend of the same task's commit counts the row change that commit already holds (r2)", () => {
    stageBacklog(amendRow('M19.52'));
    g.git('commit', '-q', '-m', `${SUBJECT}\n\n1 minor carried to M19.52.`, '--no-verify');
    // only a code fix staged: the staged diff no longer shows the row, HEAD does
    g.write('fix.txt', 'x');
    g.git('add', 'fix.txt');
    assert.equal(check('1 minor carried to M19.52.').status, 0);
    // another task's commit at HEAD lends it nothing
    g.git('commit', '-q', '--amend', '-m', 'M19.52: fix(harness): other task', '--no-verify');
    g.write('fix2.txt', 'x');
    g.git('add', 'fix2.txt');
    assert.equal(check('1 minor carried to M19.52.').status, 1);
  });

  it('NFR-DX-003: each row a list after "carried to" names must change (r1 F2)', () => {
    stageBacklog(amendRow('M19.52'));
    for (const body of ['minors carried to M19.52 and M19.42.', 'minors carried to M19.52, M19.42.', 'minors carried to rows M19.52/M19.42.']) {
      const r = check(body);
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, /M19\.42/);
    }
    stageBacklog((text) => amendRow('M19.42')(amendRow('M19.52')(text)));
    assert.equal(check('minors carried to M19.52 and M19.42.').status, 0);
  });
});
