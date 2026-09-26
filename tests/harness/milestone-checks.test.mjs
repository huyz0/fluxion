// NFR-DX-003 (M0 cp1 F1): completion legs reject stubs; only real evidence turns them green.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkDryRuns, checkReviewerSmoke } from '../../scripts/gates/milestone-checks.mjs';
import { out, sandbox } from './helpers.mjs';

/** Evaluate `expr` against the sandbox copy of milestone-checks.mjs (its git() uses that repo). */
function inRepo(sb, expr) {
  sb.write('probe.mjs', `import * as c from './scripts/gates/milestone-checks.mjs';\nconsole.log(JSON.stringify(${expr}));\n`);
  const r = sb.node('probe.mjs');
  assert.equal(r.status, 0, out(r));
  return JSON.parse(r.stdout);
}

const section = (tool, { success = true, impossible = true } = {}) =>
  `## ${tool}\n\n${success ? '### Success\nDate: 2026-10-01\nOutcome: goal ended when toy gate exited 0 (3 turns)\n\n' : ''}${impossible ? '### Impossible\nDate: 2026-10-01\nOutcome: stopped with blockedReason after 3 failed attempts\n\n' : ''}`;

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
