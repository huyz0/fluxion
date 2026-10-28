// NFR-DX-003 / non-negotiable 4: a commit needs a pass verdict bound to its reviewed content (ADR-0195).
import assert from 'node:assert/strict';
import { chmodSync, readdirSync, rmSync } from 'node:fs';
import { after, afterEach, before, describe, it } from 'node:test';
import { out, sandbox } from './helpers.mjs';

const TASK = 'M0.5';
let sb;

const hash = () => sb.node('scripts/harness/review.mjs', ['hash']).stdout.trim();
const verdict = (over = {}) => ({ task: TASK, kind: 'code', diff_sha256: hash(), reviewer: 'test:unit', verdict: 'pass', findings: [], ...over });
function record(v) {
  sb.write('.harness/tmp/v.json', JSON.stringify(v));
  return sb.node('scripts/harness/review.mjs', ['record', '--file', sb.path('.harness/tmp/v.json'), '--task', TASK]);
}
const checkReviewed = () => sb.node('scripts/gates/check-reviewed.mjs');
const content = (commit) => sb.node('scripts/harness/review.mjs', commit ? ['content', '--commit', commit] : ['content']).stdout.trim();
const stageDigest = () => sb.git('add', '.harness/reviews/digest.log');
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

  it('accepts after a pass verdict for this exact diff is recorded and its digest line is staged', () => {
    const r = record(verdict());
    assert.equal(r.status, 0, out(r));
    const unstaged = checkReviewed();
    assert.equal(unstaged.status, 1, out(unstaged));
    assert.match(unstaged.stderr, /digest\.log is not staged/);
    stageDigest();
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
    const r = record(
      verdict({ verdict: 'changes-requested', findings: [{ id: 'F1', file: 'src/a.txt', line: 2, severity: 'major', failure_scenario: 'two is wrong' }] }),
    );
    assert.equal(r.status, 0, out(r));
    assert.equal(checkReviewed().status, 1);
  });

  it('numbers rounds from the tracked digest, which keeps changes-requested rounds, not the local directory (M18.127)', () => {
    const digest = sb.read('.harness/reviews/digest.log');
    assert.match(digest, /^M0\.5\t[0-9a-f]{64}\tr1\tchanges-requested\ttest:unit\t1 findings\tcontent:/m);
    // local verdict files are per worktree; the round must not depend on them
    for (const f of readdirSync(sb.path('.harness/reviews')).filter((n) => n.endsWith('.json'))) rmSync(sb.path(`.harness/reviews/${f}`));
    assert.equal(sb.read('.harness/reviews/digest.log'), digest, 'the digest itself is kept');
    assert.match(record(verdict()).stdout, /round 2/);
    // a pass closes the cycle, so the round cap counts the rounds of one change
    assert.match(record(verdict()).stdout, /round 1/);
  });

  it('rejects a reviewer outside the vendor:role[:posthoc] grammar (M18.127, cp14 F6)', () => {
    for (const reviewer of ['test', 'Claude:Reviewer', 'claude:reviewer:extra', 'claude:', '', undefined]) {
      const r = record(verdict({ reviewer }));
      assert.equal(r.status, 1, `${reviewer}: ${out(r)}`);
      assert.match(r.stderr, /must be vendor:role\[:posthoc\]/);
    }
    assert.equal(record(verdict({ reviewer: 'codex:gpt-5.x' })).status, 0);
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

    it('requires a verdict when a State cell changes to descoped (M0 final F1)', () => {
      stageBacklog(base().replace('| todo | |', '| descoped (user decision; ADR-0137) | |'));
      const r = checkReviewed();
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, /no pass verdict/);
      sb.git('reset', '-q');
    });
  });

  it('appends a tracked digest line for every recorded verdict', () => {
    stage('src/c.txt', 'digest\n');
    assert.equal(record(verdict()).status, 0);
    const digest = sb.read('.harness/reviews/digest.log').trim().split('\n').at(-1).split('\t');
    assert.deepEqual([digest[0], digest[1], digest[3], digest[6]], [TASK, hash(), 'pass', `content:${content()}`]);
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
    stageDigest();
    const ok = sb.git('commit', '-q', '-m', 'M0.5: test: reviewed');
    assert.equal(ok.status, 0, out(ok));
  });
});

describe('rebase-stable content binding (ADR-0195, M18.99)', () => {
  let sbx;
  const run = (...args) => {
    const r = sbx.git(...args);
    assert.equal(r.status, 0, out(r));
    return r.stdout.trim();
  };
  const id = (commit) => sbx.node('scripts/harness/review.mjs', commit ? ['content', '--commit', commit] : ['content']).stdout.trim();
  const put = (file, text) => {
    sbx.write(file, text);
    run('add', file);
  };
  const ROW = (id, text, state = 'todo', commit = '') => `| ${id} | ${text} | HARNESS | WHEN x THE SYSTEM SHALL y | — | ${state} | ${commit} |`;
  const backlog = (rows) => `# Backlog\n\n| ID | Task | Req | Acceptance | Deps | State | Commit |\n|---|---|---|---|---|---|---|\n${rows.join('\n')}\n`;
  before(() => {
    sbx = sandbox(undefined, { git: true });
    put('src/a.txt', 'one\ntwo\nthree\n');
    put('src/b.txt', 'b\n');
    put('docs/backlog/current.md', backlog([ROW('M0.5', 'first'), ROW('M0.6', 'second')]));
    run('commit', '-q', '--no-verify', '-m', 'fixture: content base');
  });
  after(() => sbx.cleanup());
  afterEach(() => {
    sbx.git('reset', '-q', '--hard');
  });

  it('ignores loop bookkeeping, argued lines and generated reports', () => {
    put('src/a.txt', 'one\nTWO\nthree\n');
    const reviewed = id();
    assert.match(reviewed, /^[0-9a-f]{64}$/);
    put('.harness/progress.md', '# log\n');
    put('.harness/reviews/digest.log', 'M0.5\tx\tr1\tpass\tt\t0 findings\n');
    put('.harness/baselines/review-argued.txt', 'M0.5 F1 reason\n');
    put('packages/demo/api/demo.api.md', '# report\n');
    assert.equal(id(), reviewed);
  });

  it('changes when reviewed content changes, including a new file', () => {
    put('src/a.txt', 'one\nTWO\nthree\n');
    const reviewed = id();
    put('src/a.txt', 'one\nTWO!\nthree\n');
    assert.notEqual(id(), reviewed);
    put('src/a.txt', 'one\nTWO\nthree\n');
    put('src/new.txt', 'new\n');
    assert.notEqual(id(), reviewed);
  });

  it('binds whitespace, which git patch-id would ignore (M18.99 r1 F1)', () => {
    put('src/a.txt', "one\nrm -rf '/tmp/x'\nthree\n");
    const reviewed = id();
    put('src/a.txt', "one\nrm -rf '/ tmp/x'\nthree\n");
    assert.notEqual(id(), reviewed);
    put('src/a.txt', "one\n  rm -rf '/tmp/x'\nthree\n");
    assert.notEqual(id(), reviewed, 're-indentation is content');
  });

  it('binds hand-written traceability cells but not the generated Tests column (M18.99 r1 F3)', () => {
    const TRACE = 'docs/requirements/40-traceability.md';
    // IDs with digits in their area (NFR-A11Y-*) are matrix rows too (M18.99 r2 F1)
    const row = (milestone, tests, rid = 'FR-LIB-003') => `| ${rid} | M | R3 | ${milestone} | [11](11.md) | ${tests} |`;
    const matrix = (tests, a11yTests = '`b.test.ts`') => `# 40\n\n${row('M18', tests)}\n${row('M18', a11yTests, 'NFR-A11Y-002')}\n`;
    put(TRACE, matrix('`a.test.ts`'));
    run('commit', '-q', '--no-verify', '-m', 'fixture: trace');
    put('src/a.txt', 'one\nTWO\nthree\n');
    const reviewed = id();
    put(TRACE, matrix('`a.test.ts` +3', '`b.test.ts` +1'));
    assert.equal(id(), reviewed, 'the Tests column is regenerated');
    put(TRACE, `# 40\n\n${row('M19', '`a.test.ts`')}\n${row('M18', '`b.test.ts`', 'NFR-A11Y-002')}\n`);
    assert.notEqual(id(), reviewed, 'the Milestone(s) column is written by hand');
    run('reset', '-q', '--hard', 'HEAD~1');
  });

  it('binds backlog spec cells but not State or Commit cells', () => {
    put('src/a.txt', 'one\nTWO\nthree\n');
    const reviewed = id();
    put('docs/backlog/current.md', backlog([ROW('M0.5', 'first', 'done', 'abc1234'), ROW('M0.6', 'second')]));
    assert.equal(id(), reviewed, 'state and commit cells are bookkeeping');
    put('docs/backlog/current.md', backlog([ROW('M0.5', 'first'), ROW('M0.6', 'second, changed')]));
    assert.notEqual(id(), reviewed, 'task text is spec');
    put('docs/backlog/current.md', backlog([ROW('M0.5', 'first', 'descoped (decision)'), ROW('M0.6', 'second')]));
    assert.notEqual(id(), reviewed, 'descoping is a scope decision');
    put('docs/backlog/current.md', backlog([ROW('M0.5', 'first'), ROW('M0.6', 'second'), ROW('M0.7', 'added')]));
    assert.notEqual(id(), reviewed, 'a new row is spec');
  });

  it('survives a rebase onto unrelated work, and the commit then passes the gate', () => {
    put('src/a.txt', 'one\nTWO\nthree\n');
    const reviewed = id();
    const recordedAt = sbx.node('scripts/harness/review.mjs', ['hash']).stdout.trim();
    sbx.write('.harness/tmp/v.json', JSON.stringify({ task: TASK, diff_sha256: recordedAt, reviewer: 't:unit', verdict: 'pass', findings: [] }));
    assert.equal(sbx.node('scripts/harness/review.mjs', ['record', '--file', sbx.path('.harness/tmp/v.json'), '--task', TASK]).status, 0);
    run('stash', '-q');
    put('src/b.txt', 'b changed on main\n');
    put('docs/backlog/current.md', backlog([ROW('M0.5', 'first'), ROW('M0.6', 'second'), ROW('M0.8', 'main row')]));
    run('commit', '-q', '--no-verify', '-m', 'fixture: main moved');
    run('stash', 'pop', '-q', '--index');
    run('add', '.harness/reviews/digest.log');
    assert.notEqual(sbx.node('scripts/harness/review.mjs', ['hash']).stdout.trim(), recordedAt, 'the byte hash moved');
    assert.equal(id(), reviewed);
    const r = sbx.node('scripts/gates/check-reviewed.mjs');
    assert.equal(r.status, 0, out(r));
  });

  it("ignores the budget record's commit value, which land.mjs renames, and keeps binding evidence from before (M18.155, ADR-0205)", () => {
    const BUDGET = '.harness/budget.json';
    const record = (commit, quickMs = 1) => `${JSON.stringify({ recordedAt: 't', commit, quickMs }, null, 2)}\n`;
    put(BUDGET, record('a'.repeat(40)));
    run('commit', '-q', '--no-verify', '-m', 'fixture: budget');
    put(BUDGET, record('b'.repeat(40)));
    const reviewed = id();
    put(BUDGET, record('c'.repeat(40)));
    assert.equal(id(), reviewed, 'a renamed commit keeps the identity');
    put(BUDGET, record('c'.repeat(40), 2));
    assert.notEqual(id(), reviewed, 'a measured number is content');
    // only the budget record's commit is renamed by landing: the same line elsewhere stays content
    put('src/record.json', record('a'.repeat(40)));
    const elsewhere = id();
    put('src/record.json', record('e'.repeat(40)));
    assert.notEqual(id(), elsewhere, 'a commit value outside the budget record is content');
    run('reset', '-q', '--', 'src/record.json');
    // a verdict recorded under the identity from before ADR-0205 still satisfies check-reviewed
    put(BUDGET, record('d'.repeat(40)));
    sbx.write(
      '.harness/tmp/legacy.mjs',
      "import { contentId } from '../../scripts/gates/review-content.mjs';\nconsole.log(contentId(undefined, { legacy: true }));\n",
    );
    const legacy = sbx.node('.harness/tmp/legacy.mjs', []).stdout.trim();
    assert.notEqual(legacy, id(), 'the legacy identity binds the commit value');
    sbx.write('.harness/tmp/l.json', JSON.stringify({ task: TASK, content_id: legacy, diff_sha256: 'x', reviewer: 't:unit', verdict: 'pass', findings: [] }));
    const recorded = sbx.node('scripts/harness/review.mjs', ['record', '--file', sbx.path('.harness/tmp/l.json'), '--task', TASK]);
    assert.equal(recorded.status, 0, out(recorded));
    // a verdict and digest line written before ADR-0205 carry the legacy identity
    rmSync(sbx.path('.harness/review'), { recursive: true, force: true });
    sbx.write('.harness/review/legacy.json', JSON.stringify({ task: TASK, verdict: 'pass', content_id: legacy }));
    put('.harness/reviews/digest.log', `${TASK}\t-\tr1\tpass\tt:unit\t0 findings\tcontent:${legacy}\n`);
    const checked = sbx.node('scripts/gates/check-reviewed.mjs', []);
    assert.equal(checked.status, 0, out(checked));
    run('reset', '-q', '--hard', 'HEAD~1');
  });

  it('records an after-the-fact review of a landed commit only with its content identity', () => {
    put('src/a.txt', 'landed\n');
    run('commit', '-q', '--no-verify', '-m', 'M0.5: test: landed');
    const sha = run('rev-parse', 'HEAD');
    const packet = sbx.node('scripts/harness/review.mjs', ['context', '--task', TASK, '--commit', sha]);
    assert.equal(packet.status, 0, out(packet));
    assert.match(packet.stdout, new RegExp(`content_id: ${id(sha)}`));
    assert.match(packet.stdout, /\+landed/);
    const v = (content_id, reviewer = 't:unit:posthoc') => {
      sbx.write('.harness/tmp/p.json', JSON.stringify({ task: TASK, content_id, reviewer, verdict: 'pass', findings: [] }));
      return sbx.node('scripts/harness/review.mjs', ['record', '--file', sbx.path('.harness/tmp/p.json'), '--task', TASK, '--commit', sha]);
    };
    const wrong = v('0'.repeat(64));
    assert.equal(wrong.status, 1, out(wrong));
    assert.match(wrong.stderr, /content_id does not match commit/);
    const live = v(id(sha), 't:unit');
    assert.equal(live.status, 1, 'a landed commit is reviewed after the fact (M18.127)');
    assert.match(live.stderr, /reviewer vendor:role:posthoc/);
    assert.equal(v(id(sha)).status, 0);
    assert.match(sbx.read('.harness/reviews/digest.log'), new RegExp(`^M0\\.5\\t-\\tr\\d+\\tpass\\tt:unit:posthoc\\t0 findings\\tcontent:${id(sha)}$`, 'm'));
  });

  it('rebinds a pass line to a landed commit only when it reviewed that exact diff, marked rebind (M18.127)', () => {
    const DIGEST = '.harness/reviews/digest.log';
    const lines = () => sbx.read(DIGEST).split('\n').filter(Boolean);
    const rebind = (commit, n, task = TASK) => sbx.node('scripts/harness/review.mjs', ['rebind', '--task', task, '--commit', commit, '--line', String(n)]);
    const recordStaged = (v) => {
      sbx.write(
        '.harness/tmp/v.json',
        JSON.stringify({ task: TASK, diff_sha256: sbx.node('scripts/harness/review.mjs', ['hash']).stdout.trim(), reviewer: 't:unit', findings: [], ...v }),
      );
      const r = sbx.node('scripts/harness/review.mjs', ['record', '--file', sbx.path('.harness/tmp/v.json'), '--task', TASK]);
      assert.equal(r.status, 0, out(r));
      return lines().length;
    };
    put('src/a.txt', 'rebound\n');
    const cr = recordStaged({ verdict: 'changes-requested', findings: [{ id: 'F1', file: 'src/a.txt', severity: 'major', failure_scenario: 'x' }] });
    const pass = recordStaged({ verdict: 'pass' });
    // the commit carries its own digest lines, as every real task commit does (M18.127 r1 F1)
    run('add', DIGEST);
    run('commit', '-q', '--no-verify', '-m', 'M0.5: test: rebound');
    const sha = run('rev-parse', 'HEAD');
    put('src/b.txt', 'other diff\n');
    recordStaged({ verdict: 'pass' });
    const other = lines().at(-1);
    run('reset', '-q', '--hard');
    // the digest is tracked now, so keep the other diff's pass line past the reset
    sbx.write(DIGEST, `${sbx.read(DIGEST)}${other}\n`);
    const otherPass = lines().length;

    for (const [n, task, why] of [
      [cr, TASK, /line \d+ is not a pass line of M0\.5/],
      [pass, 'M0.6', /line \d+ is not a pass line of M0\.6/],
      [otherPass, TASK, /reviewed diff [0-9a-f]{12}, not commit/],
      [999, TASK, /no such digest line/],
    ]) {
      const r = rebind(sha, n, task);
      assert.notEqual(r.status, 0, out(r));
      assert.match(r.stderr, why);
    }
    const before = lines().length;
    const r = rebind(sha, pass);
    assert.equal(r.status, 0, out(r));
    assert.equal(lines().length, before + 1);
    const [task, , round, verdict, reviewer, , content, bound] = lines().at(-1).split('\t');
    assert.deepEqual(
      [task, round, verdict, reviewer, content, bound],
      [TASK, lines()[pass - 1].split('\t')[2], 'rebind', 't:unit', `content:${id(sha)}`, `bound:${pass}`],
    );
  });
});
