// HARNESS NFR-DX-003: every task commit keeps durable, content-bound review evidence (M18.99, ADR-0195).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, rmSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { headerCountProblems } from '../../scripts/gates/check-digest.mjs';
import { cleanEnv, out, sandbox } from './helpers.mjs';

const POLICY = 'scripts/gates/check-digest.mjs';
const DIGEST = '.harness/reviews/digest.log';
const ROW = (id, state = 'todo', commit = '') => `| ${id} | task | HARNESS | WHEN x THE SYSTEM SHALL y | — | ${state} | ${commit} |`;
const backlog = (rows) => `# Backlog\n\n| ID | Task | Req | Acceptance | Deps | State | Commit |\n|---|---|---|---|---|---|---|\n${rows.join('\n')}\n`;
/** The ref review.mjs record and check-digest take the landed base from. */
const LANDED = 'refs/remotes/origin/main';
const line = (task, verdict = 'pass', content = '') => `${task}\tdeadbeef\tr1\t${verdict}\tt:unit\t0 findings${content ? `\tcontent:${content}` : ''}\n`;

describe('digest coverage (M18.99)', () => {
  let sb;
  const run = (...args) => {
    const r = sb.git(...args);
    assert.equal(r.status, 0, out(r));
    return r.stdout.trim();
  };
  const put = (file, text) => {
    sb.write(file, text);
    run('add', file);
  };
  const append = (file, text) => put(file, `${sb.git('show', `:${file}`).stdout}${text}`);
  const commit = (subject) => {
    run('commit', '-q', '--no-verify', '--allow-empty', '-m', subject);
    return run('rev-parse', 'HEAD');
  };
  const check = (args = []) => sb.node(POLICY, args);
  /** A task commit that changes src/<task>.txt; `evidence` decides what its own digest line carries. */
  function task(id, evidence = 'own') {
    put(`src/${id}.txt`, `${id}\n`);
    const content = sb.node('scripts/harness/review.mjs', ['content']).stdout.trim();
    if (evidence === 'own') append(DIGEST, line(id, 'pass', content));
    if (evidence === 'other') append(DIGEST, line(id, 'pass', '0'.repeat(64)));
    if (evidence === 'changes') append(DIGEST, line(id, 'changes-requested', content));
    return commit(`${id}: test: change`);
  }

  before(() => {
    sb = sandbox(['scripts']);
    sb.write('docs/milestones/roadmap.md', '# Roadmap\n\n**Current milestone: `M18`**\n');
    sb.write('docs/backlog/current.md', backlog(['M18.1', 'M18.2', 'M18.3', 'M18.4', 'M18.5', 'M18.6'].map((id) => ROW(id))));
    sb.write(DIGEST, '');
    for (const args of [
      ['init', '-q', '-b', 'main'],
      ['config', 'user.name', 'digest-test'],
      ['config', 'user.email', 'digest@example.invalid'],
      ['config', 'gc.auto', '0'],
      ['config', 'maintenance.auto', 'false'],
      ['config', 'core.autocrlf', 'false'],
      ['add', '.'],
      ['rm', '-q', '--cached', POLICY],
    ])
      run(...args);
    commit('fixture baseline without the gate');
  });
  after(() => sb.cleanup());

  it('before adoption, a task commit needs a tracked pass line for its task or a reviewed exemption', () => {
    const sha = task('M18.1', 'none');
    let r = check(['--head']);
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /M18\.1: no tracked pass digest line and no exemption/);
    put('.harness/baselines/digest-exempt.txt', `${sha.slice(0, 7)} M18.1 evidence lost with a shallow clone (cp9)\n`);
    assert.equal(check().status, 0, out(check()));
    put('.harness/baselines/digest-exempt.txt', '');
    append(DIGEST, line('M18.1', 'changes-requested'));
    assert.equal(check().status, 1, 'a changes-requested line is not evidence');
    append(DIGEST, line('M18.1'));
    r = check();
    assert.equal(r.status, 0, out(r));
    commit('chore: recover M18.1 evidence');
  });

  it('after adoption, each task commit carries a pass line bound to its own content', () => {
    run('add', POLICY);
    commit('chore: adopt the digest gate');
    task('M18.2');
    let r = check(['--head']);
    assert.equal(r.status, 0, out(r));
    task('M18.3', 'other');
    r = check(['--head']);
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /M18\.3: its tree has no pass digest line bound to its content/);
  });

  it('a later line cannot repair a landed commit after adoption; only a reviewed exemption can', () => {
    const sha = run('rev-parse', 'HEAD');
    const content = sb.node('scripts/harness/review.mjs', ['content', '--commit', sha]).stdout.trim();
    append(DIGEST, line('M18.3', 'pass', content));
    assert.equal(check().status, 1, 'evidence must be in the commit itself');
    run('reset', '-q', '--hard', 'HEAD~1');
    task('M18.3', 'changes');
    assert.equal(check(['--head']).status, 1, 'changes-requested is not a pass');
    run('reset', '-q', '--hard', 'HEAD~1');
    task('M18.3');
    assert.equal(check(['--head']).status, 0);
  });

  it('a rebind line binds content only through a pass line that reviewed the exact diff; a stale pass needs a later line binding this content (M18.127)', () => {
    const lines = () => sb.git('show', `:${DIGEST}`).stdout.split('\n').filter(Boolean).length;
    const rebindLine = (task, hash, content, n) => `${task}\t${hash}\tr1\trebind\tt:unit\t0 findings\tcontent:${content}\tbound:${n}\n`;
    const passLine = (task, hash, content) => `${task}\t${hash}\tr1\tpass\tt:unit\t0 findings\tcontent:${content}\n`;
    /** Stage src/M18.4.txt; returns its content id and the staged hash `record` would bind. */
    const staged = (text = 'M18.4\n') => {
      put('src/M18.4.txt', text);
      return [sb.node('scripts/harness/review.mjs', ['content']).stdout.trim(), sb.node('scripts/harness/review.mjs', ['hash']).stdout.trim()];
    };
    const attempt = (digestLines, expect, why) => {
      const [content, hash] = staged();
      for (const l of digestLines(content, hash)) append(DIGEST, l());
      commit('M18.4: test: change');
      const r = check(['--head']);
      run('reset', '-q', '--hard', 'HEAD~1');
      assert.equal(r.status, expect, `${why}: ${out(r)}`);
      return r.stderr;
    };
    const old = '2'.repeat(64);
    // a pass of this exact diff recorded before content ids existed, rebound to this content
    attempt((c, h) => [() => passLine('M18.4', h, old), () => rebindLine('M18.4', h, c, lines())], 0, 'a rebind of the reviewed diff binds');
    // a rebind naming a changes-requested line binds nothing
    let err = attempt(
      (c, h) => [() => line('M18.4', 'changes-requested', old), () => rebindLine('M18.4', h, c, lines())],
      1,
      'a rebind of a changes-requested line',
    );
    assert.match(err, /M18\.4: its tree has no pass digest line bound to its content/);
    // a hand-written rebind of a pass for another diff binds nothing (r1 F2)
    attempt((c) => [() => passLine('M18.4', 'a'.repeat(64), old), () => rebindLine('M18.4', 'a'.repeat(64), c, lines())], 1, 'a rebind of another diff');
    attempt((c, h) => [() => passLine('M18.4', 'a'.repeat(64), old), () => rebindLine('M18.4', h, c, lines())], 1, 'a rebind whose hash differs from its line');
    // a pass for other content after this commit's own pass shows a pass for a diff that did not land
    err = attempt((c) => [() => line('M18.4', 'pass', c), () => line('M18.4', 'pass', '3'.repeat(64))], 1, 'a stale pass after');
    assert.match(err, /M18\.4: digest line \d+ is a pass for content 333333333333, not this commit's, and no later line binds this commit's content/);
    // a later line of the task that does not bind this content does not cover it (r1 F3)
    attempt(
      (c) => [() => line('M18.4', 'pass', c), () => line('M18.4', 'pass', '3'.repeat(64)), () => line('M18.4', 'changes-requested', c)],
      1,
      'a later changes-requested line',
    );
    // the same stale pass followed by this content's own pass is covered
    attempt((c) => [() => line('M18.4', 'pass', '3'.repeat(64)), () => line('M18.4', 'pass', c)], 0, 'a later pass of this content');
  });

  it('a done row needs its Commit cell once a later commit exists', () => {
    put('docs/backlog/current.md', backlog([ROW('M18.5', 'done'), ROW('M18.6')]));
    task('M18.5');
    let r = check(['--head']);
    assert.equal(r.status, 0, `HEAD's own row may stay empty in HEAD's tree: ${out(r)}`);
    r = check();
    assert.equal(r.status, 1, 'the pending commit must fill the HEAD row (M18.99 r1 F4)');
    assert.match(r.stderr, /M18\.5: done since/);
    task('M18.6');
    r = check(['--head']);
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /M18\.5: done since [0-9a-f]{7} but its Commit cell is empty/);
    const [m185, m186] = ['M18.5', 'M18.6'].map((id) => run('log', '--format=%h', '--grep', `^${id}:`, '-1'));
    put('docs/backlog/current.md', backlog([ROW('M18.5', 'done', m185), ROW('M18.6', 'done', m186)]));
    r = check();
    assert.equal(r.status, 0, out(r));
  });

  it('a filled Commit cell names a landed commit of its own row (M18.207)', () => {
    const [m185, m186] = ['M18.5', 'M18.6'].map((id) => run('log', '--format=%h', '--grep', `^${id}:`, '-1'));
    // a sha no commit on HEAD's history has (a commit that never landed, or a typo)
    put('docs/backlog/current.md', backlog([ROW('M18.5', 'done', 'abc1234'), ROW('M18.6', 'done', m186)]));
    let r = check();
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /M18\.5: Commit cell abc1234 is not a commit on HEAD's history/);
    // another task's sha
    put('docs/backlog/current.md', backlog([ROW('M18.5', 'done', m186), ROW('M18.6', 'done', m186)]));
    r = check();
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, new RegExp(`M18\\.5: Commit cell ${m186} is a commit of another task \\(M18\\.6\\)`));
    // each row's own commit is accepted
    put('docs/backlog/current.md', backlog([ROW('M18.5', 'done', m185), ROW('M18.6', 'done', m186)]));
    r = check();
    assert.equal(r.status, 0, out(r));
  });

  it('a posthoc line that names a content identity must match a commit of its task (M18.119)', () => {
    const sha = run('log', '--format=%H', '--grep', '^M18.1:', '-1');
    const landed = sb.node('scripts/harness/review.mjs', ['content', '--commit', sha]).stdout.trim();
    const posthoc = (content) => `M18.1\t-\tr1\tpass\tclaude:independent-subagent:posthoc\t0 findings\tcontent:${content}\n`;
    append(DIGEST, posthoc(landed));
    let r = check();
    assert.equal(r.status, 0, out(r));
    append(DIGEST, posthoc('1'.repeat(64)));
    r = check();
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /M18\.1: posthoc digest line names content 111111111111, which no M18\.1 commit has/);
    const kept = sb.git('show', `:${DIGEST}`).stdout.replace(posthoc('1'.repeat(64)), '');
    put(DIGEST, kept);
    assert.equal(check().status, 0);
  });

  it('skips a shallow clone, whose history it cannot judge, unless full history is required (M18.99 r1 F2)', () => {
    const clone = `${sb.dir}-shallow`;
    const r = sb.git('clone', '-q', '--depth', '1', `file://${sb.dir}`, clone);
    assert.equal(r.status, 0, out(r));
    const shallow = sb.node(POLICY, ['--head'], { cwd: clone });
    // the gate resolves the repository from its own location, so run the clone's copy
    const own = spawnSync(process.execPath, [`${clone}/${POLICY}`, '--head'], { cwd: clone, encoding: 'utf8', env: cleanEnv() });
    // a completion gate must judge history, so it fails instead (M18.99 r2 F2)
    const strict = spawnSync(process.execPath, [`${clone}/${POLICY}`, '--head', '--full-history'], { cwd: clone, encoding: 'utf8', env: cleanEnv() });
    rmSync(clone, { recursive: true, force: true });
    assert.equal(own.status, 0, out(own));
    assert.match(own.stdout, /SKIP — shallow clone/);
    assert.equal(strict.status, 1, out(strict));
    assert.match(strict.stderr, /shallow clone; fetch full history/);
    assert.ok(shallow);
  });

  it('lines added since M18.127 must carry a vendor:role[:posthoc] reviewer, decided by that grammar alone (M18.141)', () => {
    const start = run('rev-parse', 'HEAD');
    const bad = (reviewer, content = '4'.repeat(64)) => `M18.1\t-\tr9\tpass\t${reviewer}\t0 findings\tcontent:${content}\n`;
    const kept = sb.git('show', `:${DIGEST}`).stdout;
    try {
      // before any M18.127 commit, every line is judged
      for (const reviewer of ['claude:independent-subagent:m18.200-r2', 'x:y:posthoc-r2']) {
        append(DIGEST, bad(reviewer));
        const r = check();
        assert.equal(r.status, 1, `${reviewer}: ${out(r)}`);
        assert.match(r.stderr, new RegExp(`reviewer '${reviewer.replace(/\./g, '\\.')}' is not vendor:role\\[:posthoc\\] \\(M18\\.127\\)`));
        // `posthoc-r2` is not the posthoc marker: the regex fallback no longer applies to a new line
        assert.doesNotMatch(r.stderr, /posthoc digest line names content 444444444444/);
        put(DIGEST, kept);
      }
      // a free-form line already in the digest before M18.127's commit still passes
      append(DIGEST, bad('codex:gpt-6 /root/m18_review'));
      commit('chore: a pre-grammar review line');
      task('M18.127');
      let r = check(['--head']);
      assert.equal(r.status, 0, out(r));
      append(DIGEST, bad('codex:gpt-6 /root/m18_review_r2'));
      r = check();
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, /reviewer 'codex:gpt-6 \/root\/m18_review_r2' is not vendor:role/);
    } finally {
      run('reset', '-q', '--hard', start);
    }
  });
  it('HARNESS: from M18.259 a task commit whose message names more review rounds than its digest lines is refused (M18.259, cp40 F1)', () => {
    const start = run('rev-parse', 'HEAD');
    try {
      put('docs/backlog/current.md', backlog(['M18.1', 'M18.2', 'M18.3', 'M18.259'].map((id) => ROW(id))));
      commit('chore: open rows');
      const lines2 = (id, body) => {
        put(`src/${id}.txt`, `${id}\n`);
        append(DIGEST, line(id, 'pass', sb.node('scripts/harness/review.mjs', ['content']).stdout.trim()));
        run('commit', '-q', '--no-verify', '-m', `${id}: test: change`, '-m', body);
        return run('rev-parse', 'HEAD');
      };
      // before M18.259's commit a body may name lost rounds
      lines2('M18.1', 'Reviewed: r1 changes-requested, r2 pass.');
      assert.equal(check(['--head']).status, 0, out(check(['--head'])));
      lines2('M18.259', 'Reviewed: pass.');
      assert.equal(check(['--head']).status, 0, out(check(['--head'])));
      // after it: one pass line under a body that says r2 changes-requested is refused
      const lost = lines2('M18.2', 'Reviewed: r1 pass, r2 changes-requested (x), r3 pass.');
      const r = check(['--head']);
      assert.equal(r.status, 1, out(r));
      assert.match(
        r.stderr,
        new RegExp(`${lost.slice(0, 7)} M18\\.2: its message or progress lines name review rounds r2, r3 \\(the text names them, the digest holds r1\\)`),
      );
      assert.match(r.stderr, /M18\.2: its message or progress lines name review round r2 as changes-requested/);
      // a landed slip is excused only by a recorded decision, so it cannot keep the gate red for good (M18.259 r4 F1)
      put('.harness/baselines/named-rounds-exempt.txt', `${lost.slice(0, 7)} M18.2 rounds lost before the hook judged messages (fixture)\n`);
      assert.equal(check().status, 0, out(check()));
      run('reset', '-q', '--hard', 'HEAD^');
      // the commit being made: the commit-msg hook judges its message against its staged lines before it lands (M18.259 r4 F1)
      sb.write('.githooks/commit-msg', sb.readRepo('.githooks/commit-msg'));
      chmodSync(sb.path('.githooks/commit-msg'), 0o755);
      run('config', 'core.hooksPath', '.githooks');
      put('src/M18.2.txt', 'hooked\n');
      append(DIGEST, line('M18.2', 'pass', sb.node('scripts/harness/review.mjs', ['content']).stdout.trim()));
      const denied = sb.git('commit', '-q', '-m', 'M18.2: test: change', '-m', 'Reviewed: r1 changes-requested (x), r2 pass.');
      assert.equal(denied.status, 1, out(denied));
      assert.match(out(denied), /digest message: M18\.2: its message or progress lines name review round r2 \(the text names it, the digest holds r1\)/);
      assert.equal(run('log', '-1', '--format=%s'), 'M18.259: test: change');
      const named = sb.git('commit', '-q', '-m', 'M18.2: test: change', '-m', 'Reviewed: r1 pass.');
      assert.equal(named.status, 0, out(named));
      run('config', '--unset', 'core.hooksPath');
      run('reset', '-q', '--hard', 'HEAD^');
      // a body under a subject line that cites a checkpoint is still read (M18.259 r1 F1)
      put('src/M18.2.txt', 'M18.2\n');
      append(DIGEST, line('M18.2', 'pass', sb.node('scripts/harness/review.mjs', ['content']).stdout.trim()));
      run('commit', '-q', '--no-verify', '-m', 'M18.2: test: change (cp40 F1)', '-m', 'Reviewed: r1 changes-requested (x), r2 pass.');
      assert.equal(check(['--head']).status, 1, out(check(['--head'])));
      run('reset', '-q', '--hard', 'HEAD^');
      // another task's or checkpoint's rounds, named in their own sentence, are not read; the rounds held pass
      lines2('M18.3', 'This follows M18.1 r4 changes-requested. cp40 r2 F1 asked for it.');
      assert.equal(check(['--head']).status, 0, out(check(['--head'])));
    } finally {
      run('reset', '-q', '--hard', start);
    }
  });

  it('HARNESS: a task commit is refused while its digest lines lack any round its text names, not only one past the highest (M18.268, cp42 F6)', () => {
    const start = run('rev-parse', 'HEAD');
    /** A digest line of round `n`; a verdict `posthoc` is a changes-requested line a posthoc reviewer wrote. */
    const at = (task, n, verdict, content) =>
      `${task}\tdeadbeef\tr${n}\t${verdict === 'posthoc' ? 'changes-requested\tt:unit:posthoc' : `${verdict}\tt:unit`}\t0 findings\tcontent:${content}\n`;
    const body = 'Reviewed: r1 changes-requested, r2 changes-requested, r3 pass.';
    try {
      put('docs/backlog/current.md', backlog(['M18.259', 'M18.4'].map((id) => ROW(id))));
      commit('chore: open rows');
      put('src/M18.259.txt', 'x\n');
      append(DIGEST, line('M18.259', 'pass', sb.node('scripts/harness/review.mjs', ['content']).stdout.trim()));
      run('commit', '-q', '--no-verify', '-m', 'M18.259: test: change', '-m', 'Reviewed: pass.');
      const base = run('rev-parse', 'HEAD');
      /** M18.4's change with digest lines of the given rounds, `[n, verdict]`. */
      const stage = (rounds) => {
        put('src/M18.4.txt', 'x\n');
        const content = sb.node('scripts/harness/review.mjs', ['content']).stdout.trim();
        append(DIGEST, rounds.map(([n, verdict]) => at('M18.4', n, verdict, content)).join(''));
      };
      // r1 and r3 held, r2 lost: refused by check-digest over history
      stage([
        [1, 'changes-requested'],
        [3, 'pass'],
      ]);
      run('commit', '-q', '--no-verify', '-m', 'M18.4: test: change', '-m', body);
      const r = check(['--head']);
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, /M18\.4: its message or progress lines name review round r2 \(the text names it, the digest holds r1, r3\)/);
      assert.match(r.stderr, /M18\.4: its message or progress lines name review round r2 as changes-requested/);
      // and by the commit-msg hook before it lands
      run('reset', '-q', '--hard', base);
      sb.write('.githooks/commit-msg', sb.readRepo('.githooks/commit-msg'));
      chmodSync(sb.path('.githooks/commit-msg'), 0o755);
      run('config', 'core.hooksPath', '.githooks');
      stage([
        [1, 'changes-requested'],
        [3, 'pass'],
      ]);
      const denied = sb.git('commit', '-q', '-m', 'M18.4: test: change', '-m', body);
      assert.equal(denied.status, 1, out(denied));
      assert.match(out(denied), /digest message: M18\.4: its message or progress lines name review round r2 \(the text names it, the digest holds r1, r3\)/);
      // r2 appended as a posthoc changes-requested line: accepted by the hook and by check-digest
      append(DIGEST, at('M18.4', 2, 'posthoc', sb.node('scripts/harness/review.mjs', ['content']).stdout.trim()));
      const accepted = sb.git('commit', '-q', '-m', 'M18.4: test: change', '-m', body);
      assert.equal(accepted.status, 0, out(accepted));
      run('config', '--unset', 'core.hooksPath');
      assert.equal(check(['--head']).status, 0, out(check(['--head'])));
      // a second commit of the same task counts its rounds again: the first commit's r1 and r2 never stand in for its own (r1 F1)
      put('src/M18.4.txt', 'y\n');
      append(DIGEST, at('M18.4', 3, 'pass', sb.node('scripts/harness/review.mjs', ['content']).stdout.trim()));
      run('commit', '-q', '--no-verify', '-m', 'M18.4: test: again', '-m', body);
      const again = check(['--head']);
      assert.equal(again.status, 1, out(again));
      assert.match(again.stderr, /M18\.4: its message or progress lines name review rounds r1, r2 \(the text names them, the digest holds r3\)/);
      // an amend that folds in a review fix keeps the amended commit's rounds, in the hook as over history (r2 F2): with the landed
      // base below the first commit, its r1-r3 lines and the amend's r4 are all one change's
      run('reset', '-q', '--hard', 'HEAD^');
      run('update-ref', LANDED, base);
      run('config', 'core.hooksPath', '.githooks');
      put('src/M18.4.txt', 'z\n');
      append(DIGEST, at('M18.4', 4, 'pass', sb.node('scripts/harness/review.mjs', ['content']).stdout.trim()));
      const amended = sb.git('commit', '-q', '--amend', '-m', 'M18.4: test: change', '-m', 'Reviewed: r1 and r2 changes-requested, r3 pass, r4 pass.');
      assert.equal(amended.status, 0, out(amended));
      run('config', '--unset', 'core.hooksPath');
      // (its earlier lines bind the earlier contents, which other legs refuse; the rounds agree)
      assert.doesNotMatch(out(check(['--head'])), /names review/);
    } finally {
      sb.git('config', '--unset', 'core.hooksPath');
      sb.git('update-ref', '-d', LANDED);
      run('reset', '-q', '--hard', start);
    }
  });

  it("HARNESS: a commit's own progress lines are read for its rounds, as review.mjs record reads them (M18.270, cp43 F2)", () => {
    const start = run('rev-parse', 'HEAD');
    const at = (n, verdict, reviewer, content) => `M18.5\tdeadbeef\tr${n}\t${verdict}\t${reviewer}\t0 findings\tcontent:${content}\n`;
    try {
      put('docs/backlog/current.md', backlog(['M18.259', 'M18.5'].map((id) => ROW(id))));
      commit('chore: open rows');
      put('src/M18.259.txt', 'x\n');
      append(DIGEST, line('M18.259', 'pass', sb.node('scripts/harness/review.mjs', ['content']).stdout.trim()));
      run('commit', '-q', '--no-verify', '-m', 'M18.259: test: change', '-m', 'Reviewed: pass.');
      const base = run('rev-parse', 'HEAD');
      // a silent body; the progress hunk sends r2 back, while the digest holds r2 as a pass
      const stage = () => {
        put('src/M18.5.txt', 'x\n');
        put(
          '.harness/progress.md',
          `${sb.git('show', ':.harness/progress.md').stdout}## M18.5\n- Review r1 changes-requested (a), r2 changes-requested (b).\n`,
        );
        const content = sb.node('scripts/harness/review.mjs', ['content']).stdout.trim();
        append(DIGEST, `${at(1, 'changes-requested', 't:unit', content)}${at(2, 'pass', 't:unit', content)}`);
      };
      const refusal = /M18\.5: its message or progress lines name review round r2 as changes-requested/;
      stage();
      run('commit', '-q', '--no-verify', '-m', 'M18.5: test: change', '-m', 'A change.');
      const r = check(['--head']);
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, refusal);
      // and the commit-msg hook, before it lands
      run('reset', '-q', '--hard', base);
      sb.write('.githooks/commit-msg', sb.readRepo('.githooks/commit-msg'));
      chmodSync(sb.path('.githooks/commit-msg'), 0o755);
      run('config', 'core.hooksPath', '.githooks');
      stage();
      const denied = sb.git('commit', '-q', '-m', 'M18.5: test: change', '-m', 'A change.');
      assert.equal(denied.status, 1, out(denied));
      assert.match(out(denied), refusal);
      // a posthoc line holds the round sent back: accepted by the hook and over history
      append(DIGEST, at(2, 'changes-requested', 't:unit:posthoc', ''));
      const accepted = sb.git('commit', '-q', '-m', 'M18.5: test: change', '-m', 'A change.');
      assert.equal(accepted.status, 0, out(accepted));
      run('config', '--unset', 'core.hooksPath');
      assert.doesNotMatch(out(check(['--head'])), /names? review/);
    } finally {
      sb.git('config', '--unset', 'core.hooksPath');
      run('reset', '-q', '--hard', start);
    }
  });

  it('HARNESS: from M18.231 a commit adds only its own task digest lines, and progress.md names only landed rows (M18.231, cp34 F2)', () => {
    const start = run('rev-parse', 'HEAD');
    try {
      // a backlog of open rows, so earlier cases' done rows ask for no Commit cell here
      const final = '| M18.43 | Final independent milestone review, dispositions and closeout | HARNESS | WHEN x THE SYSTEM SHALL y | — | todo | |';
      put('docs/backlog/current.md', backlog([...['M18.1', 'M18.2', 'M18.3', 'M18.5', 'M18.6', 'M18.231'].map((id) => ROW(id)), final]));
      commit('chore: open rows');
      // before M18.231 a carried line passes
      put('src/carry.txt', 'x\n');
      append(DIGEST, line('M18.5', 'changes-requested'));
      task('M18.1');
      assert.equal(check(['--head']).status, 0, out(check(['--head'])));
      task('M18.231');
      let r = check(['--head']);
      assert.equal(r.status, 0, out(r));
      // after it, a task commit carrying another row's line is refused, by commit
      append(DIGEST, line('M18.6', 'changes-requested'));
      const carried = task('M18.2');
      r = check(['--head']);
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, new RegExp(`${carried.slice(0, 7)} M18\\.2: adds review digest lines of M18\\.6, another row's \\(M18\\.231\\)`));
      run('reset', '-q', '--hard', 'HEAD^');
      // staged: judged against state.json's currentTask
      put('.harness/state.json', JSON.stringify({ currentTask: 'M18.3' }));
      append(DIGEST, line('M18.3', 'changes-requested'));
      assert.equal(check().status, 0, out(check()));
      append(DIGEST, line('M18.6', 'changes-requested'));
      r = check();
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, /staged M18\.3: adds review digest lines of M18\.6/);
      run('reset', '-q', '--hard', 'HEAD');
      // the staged owner is the row whose pass line binds the staged content, not state.json's currentTask, which another
      // stream may have set (M18.231 r2 F1); its own lines pass, a third row's are still refused
      put('.harness/state.json', JSON.stringify({ currentTask: 'M18.6' }));
      put('src/owner.txt', 'x\n');
      append(DIGEST, line('M18.3', 'changes-requested'));
      append(DIGEST, line('M18.3', 'pass', sb.node('scripts/harness/review.mjs', ['content']).stdout.trim()));
      r = check();
      assert.equal(r.status, 0, out(r));
      append(DIGEST, line('M18.5', 'changes-requested'));
      r = check();
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, /staged M18\.3: adds review digest lines of M18\.5/);
      assert.doesNotMatch(r.stderr, /lines of M18\.3/);
      run('reset', '-q', '--hard', 'HEAD');
      // any commit may carry checkpoint records (the final-review row), rebind and posthoc lines (M18.231 r1 F1, F4)
      put('.harness/state.json', JSON.stringify({ currentTask: 'M18.3' }));
      append(DIGEST, line('M18.43', 'pass', '5'.repeat(64)));
      append(DIGEST, 'M18.6\t-\tr1\trebind\tharness:rebind\t0 findings\tcontent:6666\tbound:1\n');
      append(DIGEST, `M18.6\tdeadbeef\tr2\tpass\tclaude:independent-subagent:posthoc\t0 findings\tcontent:${'7'.repeat(64)}\n`);
      r = check();
      assert.doesNotMatch(r.stderr, /another row's/, out(r));
      run('reset', '-q', '--hard', 'HEAD');
      // progress: an entry for a row with no commit is refused unless headed (not landed …); the staged task's own entry passes
      put('.harness/state.json', JSON.stringify({ currentTask: 'M18.3' }));
      put('.harness/progress.md', '## 2026-11-02 M18.1: landed\n\n## 2026-11-02 M18.3: this commit\n');
      assert.equal(check().status, 0, out(check()));
      put('.harness/progress.md', '## 2026-11-02 M18.1: landed\n\n## 2026-11-02 M18.9: carried\n');
      r = check();
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, /progress\.md has an entry for M18\.9, which has no commit/);
      put('.harness/progress.md', '## 2026-11-02 M18.9: carried (not landed: a replay carried it)\n');
      assert.equal(check().status, 0, out(check()));
      // the `## <task> — title (date)` heading form is judged too (M18.231 r2 F2)
      put('.harness/progress.md', '## M18.9 — carried by a replay (2026-11-02)\n');
      r = check();
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, /progress\.md has an entry for M18\.9, which has no commit/);
      put('.harness/progress.md', '## M18.9 — attempt measured, not landed (2026-11-02)\n');
      assert.equal(check().status, 0, out(check()));
    } finally {
      run('reset', '-q', '--hard', start);
    }
  });
});

describe('backlog header count (M18.223, cp32 F5)', () => {
  const text = (stated, n) => `Planned: 3 rows; current: ${stated} rows.\n\n${Array.from({ length: n }, (_, i) => ROW(`M0.${i + 1}`)).join('\n')}\n`;
  it('accepts a header whose count matches the rows', () => assert.deepEqual(headerCountProblems(text(2, 2)), []));
  it('names a header whose count drifted from the rows', () => assert.match(headerCountProblems(text(3, 2))[0], /current: 3 but it has 2 rows/));
  it('ignores a backlog without a count header', () => assert.deepEqual(headerCountProblems(backlog([ROW('M0.1')])), []));
});
