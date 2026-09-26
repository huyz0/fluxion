// NFR-DX-003 / non-negotiable 4: a commit needs a pass verdict bound to the exact staged bytes.
import assert from 'node:assert/strict';
import { chmodSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { out, sandbox } from './helpers.mjs';

const TASK = 'M0.5';
let sb;

const hash = () => sb.node('scripts/harness/review.mjs', ['hash']).stdout.trim();
const verdict = (over = {}) => ({ task: TASK, kind: 'code', diff_sha256: hash(), reviewer: 'test', verdict: 'pass', findings: [], ...over });
function record(v) {
  sb.write('.harness/tmp/v.json', JSON.stringify(v));
  return sb.node('scripts/harness/review.mjs', ['record', '--file', sb.path('.harness/tmp/v.json'), '--task', TASK]);
}
const checkReviewed = () => sb.node('scripts/gates/check-reviewed.mjs');
function stage(file, text) {
  sb.write(file, text);
  sb.git('add', file);
}

describe('review binding (NFR-DX-003)', () => {
  before(() => {
    sb = sandbox(undefined, { git: true });
  });
  after(() => sb.cleanup());

  it('passes when nothing is staged', () => {
    assert.equal(checkReviewed().status, 0);
  });

  it('refuses a staged change without a verdict', () => {
    stage('src/a.txt', 'one\n');
    const r = checkReviewed();
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /no pass verdict/);
  });

  it('accepts after a pass verdict for this exact diff is recorded', () => {
    const r = record(verdict());
    assert.equal(r.status, 0, out(r));
    assert.equal(checkReviewed().status, 0);
  });

  it('refuses again once the staged bytes change after review', () => {
    stage('src/a.txt', 'one\ntwo\n');
    assert.equal(checkReviewed().status, 1);
  });

  it('rejects recording a verdict whose hash does not match the staged diff', () => {
    const r = record(verdict({ diff_sha256: '0'.repeat(64) }));
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /does not match the staged diff/);
  });

  it('rejects a pass verdict that carries a blocking finding', () => {
    const r = record(verdict({ findings: [{ id: 'F1', file: 'src/a.txt', line: 1, severity: 'blocking', failure_scenario: 'x' }] }));
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /pass with blocking/);
  });

  it('rejects findings without a failure scenario', () => {
    const r = record(verdict({ verdict: 'changes-requested', findings: [{ id: 'F1', file: 'src/a.txt', severity: 'major' }] }));
    assert.equal(r.status, 1, out(r));
  });

  it('records changes-requested, which does not satisfy the gate', () => {
    const r = record(verdict({ verdict: 'changes-requested', findings: [{ id: 'F1', file: 'src/a.txt', line: 2, severity: 'major', failure_scenario: 'two is wrong' }] }));
    assert.equal(r.status, 0, out(r));
    assert.equal(checkReviewed().status, 1);
  });

  it('numbers rounds per task', () => {
    assert.match(record(verdict()).stdout, /round 3/);
  });

  it('exempts bookkeeping-only commits', () => {
    sb.git('reset', '-q');
    stage('.harness/progress.md', '# log\n');
    assert.equal(checkReviewed().status, 0);
    sb.git('reset', '-q');
  });

  describe('backlog bookkeeping exemption (M0 cp1 F2)', () => {
    const ROW = '| M0.5 | task text | NFR-DX-003 | WHEN x THE SYSTEM SHALL y | — | todo | |';
    const stageBacklog = (text) => {
      sb.write('docs/backlog/current.md', text);
      sb.git('add', 'docs/backlog/current.md');
    };
    before(() => {
      sb.git('reset', '-q');
      stageBacklog(`# Backlog\n\n| ID | Task | Req | Acceptance | Deps | State | Commit |\n|---|---|---|---|---|---|---|\n${ROW}\n`);
      sb.git('commit', '-q', '--no-verify', '-m', 'M0.5: test: backlog fixture');
    });
    const base = () => sb.git('show', 'HEAD:docs/backlog/current.md').stdout;

    it('exempts a change to State/Commit cells only', () => {
      stageBacklog(base().replace('| todo | |', '| done | abc1234 |'));
      assert.equal(checkReviewed().status, 0);
      sb.git('reset', '-q');
    });

    it('requires a verdict when acceptance text changes', () => {
      stageBacklog(base().replace('THE SYSTEM SHALL y', 'THE SYSTEM MAY y'));
      assert.equal(checkReviewed().status, 1);
      sb.git('reset', '-q');
    });

    it('requires a verdict when a row is added', () => {
      stageBacklog(`${base()}| M0.99 | new | x | x | — | todo | |\n`);
      assert.equal(checkReviewed().status, 1);
      sb.git('reset', '-q');
    });
  });

  it('appends a tracked digest line for every recorded verdict', () => {
    stage('src/c.txt', 'digest\n');
    assert.equal(record(verdict()).status, 0);
    const digest = sb.read('.harness/reviews/digest.log').trim().split('\n').at(-1).split('\t');
    assert.deepEqual([digest[0], digest[1], digest[3]], [TASK, hash(), 'pass']);
    sb.git('reset', '-q');
  });

  it('the tracked pre-commit hook refuses an unreviewed commit', () => {
    // the real tracked hook, which runs the full precommit ladder with --staged
    sb.write('.githooks/pre-commit', sb.readRepo('.githooks/pre-commit'));
    chmodSync(sb.path('.githooks/pre-commit'), 0o755); // POSIX git skips non-executable hooks
    sb.git('config', 'core.hooksPath', '.githooks');
    stage('src/b.txt', 'unreviewed\n');
    const refused = sb.git('commit', '-q', '-m', 'M0.5: test: unreviewed');
    assert.notEqual(refused.status, 0, out(refused));
    record(verdict());
    const ok = sb.git('commit', '-q', '-m', 'M0.5: test: reviewed');
    assert.equal(ok.status, 0, out(ok));
  });
});
