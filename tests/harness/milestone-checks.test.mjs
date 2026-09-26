// NFR-DX-003 (M0 cp1 F1): completion legs reject stubs; only real evidence turns them green.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkBacklogDone, checkDryRuns, checkReviewerSmoke } from '../../scripts/gates/milestone-checks.mjs';
import { out, sandbox } from './helpers.mjs';

/** Evaluate `expr` against the sandbox copy of milestone-checks.mjs (its git() uses that repo). */
function inRepo(sb, expr) {
  sb.write('probe.mjs', `import * as c from './scripts/gates/milestone-checks.mjs';\nconsole.log(JSON.stringify(${expr}));\n`);
  const r = sb.node('probe.mjs');
  assert.equal(r.status, 0, out(r));
  return JSON.parse(r.stdout);
}

const section = (tool, { success = true, impossible = true } = {}) =>
  `## ${tool}\n\n${success ? '### Success\nDate: 2026-10-01\nOutcome: goal ended when toy gate exited 0 (3 turns)\nTranscript: logs/success.txt\n\n' : ''}${impossible ? '### Impossible\nDate: 2026-10-01\nOutcome: stopped with blockedReason after 3 failed attempts\nTranscript: logs/impossible.txt\n\n' : ''}`;

describe('checkDryRuns (NFR-DX-003)', () => {
  it('accepts per-tool success and impossible sections with outcomes', () => {
    assert.equal(checkDryRuns(`# Dry runs\n\n${section('Claude Code')}${section('Codex')}`), true);
  });

  it('rejects a one-sentence stub that merely mentions the words', () => {
    const r = checkDryRuns('Claude and Codex dry runs: success and impossible cases all fine.');
    assert.match(String(r), /missing ## Claude Code, ## Codex/);
  });

  it('rejects a tool missing its impossible case', () => {
    const r = checkDryRuns(`${section('Claude Code')}${section('Codex', { impossible: false })}`);
    assert.match(String(r), /Codex \/ ### Impossible/);
  });

  it('rejects empty Outcome lines', () => {
    const r = checkDryRuns(`${section('Claude Code')}${section('Codex').replace(/Outcome: .*$/gm, 'Outcome:')}`);
    assert.match(String(r), /Codex \/ Success \/ Outcome:/);
  });
});

describe('checkReviewerSmoke (NFR-DX-003)', () => {
  const H1 = 'a'.repeat(64);
  const H2 = 'b'.repeat(64);
  const line = (...cols) => `${cols.join('\t')}\n`;
  const DIGEST =
    line('M0.13', H1, 'r1', 'changes-requested', 'codex:gpt-5', '1 findings') +
    line('M0.13', H2, 'r1', 'pass', 'claude-subagent:reviewer', '0 findings') +
    line('M0.22', 'c'.repeat(64), 'r1', 'pass', 'claude-subagent:reviewer', '0 findings');
  const run = (author, reviewer, caught, diff_sha256 = author === 'claude' ? H1 : H2) => ({ author, reviewer, seededDefect: 'off-by-one in fixture', diff_sha256, caught });

  it('accepts both directions, recorded for M0.13 by the matching vendor, with a catch', () => {
    assert.equal(checkReviewerSmoke({ runs: [run('claude', 'codex', true), run('codex', 'claude', false)] }, DIGEST), true);
  });

  it('rejects a single direction', () => {
    assert.match(String(checkReviewerSmoke({ runs: [run('claude', 'codex', true)] }, DIGEST)), /codex->claude/);
  });

  it('rejects when nothing was caught', () => {
    assert.match(String(checkReviewerSmoke({ runs: [run('claude', 'codex', false), run('codex', 'claude', false)] }, DIGEST)), /no direction caught/);
  });

  it('rejects runs without a well-formed verdict hash', () => {
    assert.match(String(checkReviewerSmoke({ runs: [run('claude', 'codex', true, 'x'), run('codex', 'claude', true)] }, DIGEST)), /diff_sha256/);
  });

  it('rejects a hash that was never recorded', () => {
    const r = checkReviewerSmoke({ runs: [run('claude', 'codex', true, 'd'.repeat(64)), run('codex', 'claude', false)] }, DIGEST);
    assert.match(String(r), /1 run\(s\) have no M0\.13 verdict by that reviewer/);
  });

  it('rejects reusing a recorded review from another task', () => {
    const r = checkReviewerSmoke({ runs: [run('claude', 'codex', true), run('codex', 'claude', true, 'c'.repeat(64))] }, DIGEST);
    assert.match(String(r), /1 run\(s\) have no M0\.13 verdict/);
  });

  it('rejects a run whose recorded reviewer is a different vendor', () => {
    const r = checkReviewerSmoke({ runs: [run('claude', 'codex', true, H2), run('codex', 'claude', false, H1)] }, DIGEST);
    assert.match(String(r), /2 run\(s\) have no M0\.13 verdict by that reviewer/);
  });

  it('rejects two runs sharing one hash', () => {
    const r = checkReviewerSmoke({ runs: [run('claude', 'codex', true, H1), run('codex', 'claude', false, H1)] }, DIGEST);
    assert.match(String(r), /its own diff_sha256/);
  });

  it('rejects an empty record', () => {
    assert.notEqual(checkReviewerSmoke({}, DIGEST), true);
  });
});

describe('checkFinalReview and checkHooksExecutable (NFR-DX-003)', () => {
  /** Temp repo whose first commit ("fixture baseline") predates the milestone. */
  function repo() {
    const sb = sandbox(['scripts', '.githooks'], { git: true });
    const commit = (file, msg) => {
      sb.write(file, `${msg}\n`);
      sb.git('add', '-A');
      sb.git('commit', '-q', '--no-verify', '-m', msg);
      return sb.git('rev-parse', 'HEAD').stdout.trim();
    };
    const baseline = sb.git('rev-parse', 'HEAD').stdout.trim();
    return { sb, commit, baseline };
  }
  const review = (range, extra = {}) => ({ milestone: 'M0', range, reviewer: 'claude-subagent:milestone-reviewer', findings: [], dispositions: [], ...extra });
  const check = (sb, r) => inRepo(sb, `c.checkFinalReview(${JSON.stringify(r)}, 'M0')`);

  it('accepts a range from before the first milestone commit to the last code commit, then bookkeeping only', () => {
    const { sb, commit, baseline } = repo();
    try {
      commit('src/a.txt', 'M0.1: feat: a');
      const end = commit('src/b.txt', 'M0.2: feat: b');
      commit('.harness/reviews/milestone-M0-final.json', 'M0.18: docs: record final review');
      assert.equal(check(sb, review(`${baseline}..${end}`)), true);
    } finally {
      sb.cleanup();
    }
  });

  it('rejects a review that does not cover later code commits', () => {
    const { sb, commit, baseline } = repo();
    try {
      commit('src/a.txt', 'M0.1: feat: a');
      const end = commit('src/b.txt', 'M0.2: feat: b');
      commit('src/c.txt', 'M0.3: feat: c after the review');
      assert.match(check(sb, review(`${baseline}..${end}`)), /changes src\/c\.txt/);
    } finally {
      sb.cleanup();
    }
  });

  it('rejects an empty range and a range starting after the first milestone commit', () => {
    const { sb, commit } = repo();
    try {
      const first = commit('src/a.txt', 'M0.1: feat: a');
      const end = commit('src/b.txt', 'M0.2: feat: b');
      assert.match(check(sb, review(`${end}..${end}`)), /is not before the first M0 commit/);
      assert.match(check(sb, review(`${first}..${end}`)), /is not before the first M0 commit/);
    } finally {
      sb.cleanup();
    }
  });

  it('rejects malformed reviews: no reviewer, non-array findings, disposition without action', () => {
    const { sb, commit, baseline } = repo();
    try {
      const end = commit('src/a.txt', 'M0.1: feat: a');
      const range = `${baseline}..${end}`;
      assert.match(check(sb, review(range, { reviewer: '' })), /no reviewer/);
      assert.match(check(sb, review(range, { findings: 'none' })), /findings must be an array/);
      const withF1 = { findings: [{ id: 'F1', severity: 'major' }] };
      assert.match(check(sb, review(range, { ...withF1, dispositions: [{ finding: 'F1' }] })), /disposition needs finding and one of/);
      assert.equal(check(sb, review(range, { ...withF1, dispositions: [{ finding: 'F1', disposition: 'argue' }] })), true);
    } finally {
      sb.cleanup();
    }
  });

  it('rejects undispositioned major findings and wrong milestones', () => {
    const { sb, commit, baseline } = repo();
    try {
      const end = commit('src/a.txt', 'M0.1: feat: a');
      const r = review(`${baseline}..${end}`, { findings: [{ id: 'F1', severity: 'major' }] });
      assert.match(check(sb, r), /undispositioned F1/);
      assert.match(check(sb, { ...r, milestone: 'M1' }), /not for M0/);
    } finally {
      sb.cleanup();
    }
  });

  it('rejects a range whose shas are not real commits of HEAD', () => {
    const { sb, commit, baseline } = repo();
    try {
      commit('src/a.txt', 'M0.1: feat: a');
      assert.match(check(sb, review(`${baseline}..deadbeefdeadbeef`)), /deadbeefdeadbeef is not a commit/);
      assert.match(check(sb, review(`abcabcabc..${baseline}`)), /abcabcabc is not a commit/);
      sb.git('checkout', '-q', '-b', 'side');
      const side = commit('src/side.txt', 'M0.2: feat: side');
      sb.git('checkout', '-q', 'main');
      assert.match(check(sb, review(`${baseline}..${side}`)), /not an ancestor of HEAD/);
    } finally {
      sb.cleanup();
    }
  });

  it('requires tracked hooks to be executable', () => {
    const { sb } = repo();
    try {
      sb.git('update-index', '--chmod=+x', '.githooks/pre-commit', '.githooks/commit-msg');
      assert.equal(inRepo(sb, 'c.checkHooksExecutable()'), true);
      sb.git('update-index', '--chmod=-x', '.githooks/commit-msg');
      assert.match(inRepo(sb, 'c.checkHooksExecutable()'), /commit-msg/);
    } finally {
      sb.cleanup();
    }
  });
});

describe('checkBacklogDone (NFR-DX-003, M0 cp2 F1)', () => {
  const row = (id, state) => `| ${id} | task | NFR-DX-003 | WHEN x THE SYSTEM SHALL y | — | ${state} | |`;
  const backlog = (...rows) => `# Backlog\n\n| ID | Task | Req | Acceptance | Deps | State | Commit |\n|---|---|---|---|---|---|---|\n${rows.join('\n')}\n`;

  it('accepts when every row is done and reopened targets are done', () => {
    const reviews = [{ checkpoint: 'cp1', dispositions: [{ finding: 'F1', disposition: 'reopen', target: 'M0.2' }, { finding: 'F2', disposition: 'hand-off', target: 'M1' }] }];
    assert.equal(checkBacklogDone(backlog(row('M0.1', 'done'), row('M0.2', 'done')), 'M0', reviews), true);
  });

  it('rejects a row that is not done', () => {
    assert.match(String(checkBacklogDone(backlog(row('M0.1', 'done'), row('M0.2', 'blocked (needs CLI)')), 'M0')), /not done: M0\.2 \(blocked \(needs CLI\)\)/);
  });

  it('rejects a reopen whose target row is missing', () => {
    const reviews = [{ checkpoint: 'final', dispositions: [{ finding: 'F1', disposition: 'reopen', target: 'M0.24' }] }];
    assert.match(String(checkBacklogDone(backlog(row('M0.1', 'done')), 'M0', reviews)), /reopened M0\.24 missing or not done/);
  });

  it('rejects a reopen that names no row, and an empty backlog', () => {
    const reviews = [{ dispositions: [{ finding: 'F1', disposition: 'reopen', target: 'later' }] }];
    assert.match(String(checkBacklogDone(backlog(row('M0.1', 'done')), 'M0', reviews)), /names no M0 row/);
    assert.match(String(checkBacklogDone('# empty\n', 'M0')), /no M0 rows/);
  });
});

describe('checkBacklogDone inputs (M0.24 review F1-F3)', () => {
  const row = (id, state) => `| ${id} | task | NFR-DX-003 | WHEN x THE SYSTEM SHALL y | — | ${state} | |`;

  it('rejects duplicate row ids (a later done row cannot hide a todo one)', () => {
    assert.match(String(checkBacklogDone(`${row('M0.13', 'todo')}\n${row('M0.13', 'done')}\n`, 'M0')), /duplicate backlog rows: M0\.13/);
  });

  it('loads reviews of any checkpoint name, and reads archived rows once archived', () => {
    const sb = sandbox(['scripts'], { git: true });
    try {
      sb.write('.harness/reviews/milestone-M0-cp1.json', JSON.stringify({ milestone: 'M0', checkpoint: 'cp1', dispositions: [] }));
      sb.write('.harness/reviews/milestone-M0-cp3.json', JSON.stringify({ milestone: 'M0', checkpoint: 'cp3', dispositions: [{ finding: 'F1', disposition: 'reopen', target: 'M0.26' }] }));
      sb.write('.harness/reviews/milestone-M1-cp1.json', JSON.stringify({ milestone: 'M1', checkpoint: 'cp1', dispositions: [] }));
      sb.write('docs/backlog/current.md', `${row('M1.1', 'todo')}\n`);
      sb.write('docs/backlog/archive/M0.md', `${row('M0.1', 'done')}\n`);
      const names = inRepo(sb, "c.loadMilestoneReviews('M0').map((r) => r.checkpoint)");
      assert.deepEqual(names, ['cp1', 'cp3']);
      assert.match(inRepo(sb, "c.backlogTextFor('M0')"), /M0\.1/);
      assert.match(inRepo(sb, "c.checkBacklogDone(c.backlogTextFor('M0'), 'M0', c.loadMilestoneReviews('M0'))"), /cp3 F1: reopened M0\.26 missing or not done/);
    } finally {
      sb.cleanup();
    }
  });
});

describe('descoped rows (NFR-DX-003, user decision 2026-09-26)', () => {
  const row = (id, state) => `| ${id} | task | NFR-DX-003 | WHEN x THE SYSTEM SHALL y | — | ${state} | |`;

  it('accepts a row descoped with a stated reason', () => {
    assert.equal(checkBacklogDone(`${row('M0.1', 'done')}\n${row('M0.2', 'descoped (user decision 2026-09-26; roadmap Deferred)')}\n`, 'M0'), true);
  });

  it('rejects a bare descoped state and a descoped reopen target', () => {
    assert.match(String(checkBacklogDone(`${row('M0.1', 'descoped')}\n`, 'M0')), /not done: M0\.1/);
    const reviews = [{ checkpoint: 'cp9', dispositions: [{ finding: 'F1', disposition: 'reopen', target: 'M0.2' }] }];
    assert.match(String(checkBacklogDone(`${row('M0.2', 'descoped (later)')}\n`, 'M0', reviews)), /reopened M0\.2 missing or not done/);
  });
});
