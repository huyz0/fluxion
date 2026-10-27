// HARNESS NFR-DX-003: every task commit keeps durable, content-bound review evidence (M18.99, ADR-0195).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { cleanEnv, out, sandbox } from './helpers.mjs';

const POLICY = 'scripts/gates/check-digest.mjs';
const DIGEST = '.harness/reviews/digest.log';
const ROW = (id, state = 'todo', commit = '') => `| ${id} | task | HARNESS | WHEN x THE SYSTEM SHALL y | — | ${state} | ${commit} |`;
const backlog = (rows) => `# Backlog\n\n| ID | Task | Req | Acceptance | Deps | State | Commit |\n|---|---|---|---|---|---|---|\n${rows.join('\n')}\n`;
const line = (task, verdict = 'pass', content = '') => `${task}\tdeadbeef\tr1\t${verdict}\tt\t0 findings${content ? `\tcontent:${content}` : ''}\n`;

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
    put('docs/backlog/current.md', backlog([ROW('M18.5', 'done', 'abc1234'), ROW('M18.6', 'done', 'def5678')]));
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
});
