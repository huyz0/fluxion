// NFR-DX-003 (M0 cp1 F1): completion legs reject stubs; only real evidence turns them green.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  changesetGaps,
  checkAdrBeforeRows,
  checkAllowlistEmpty,
  checkBacklogDone,
  checkDistArtifacts,
  checkDryRuns,
  checkExitChecklist,
  checkPngEvidence,
  checkReviewerSmoke,
  checkRowsDone,
  checkRowsTitled,
  checkVerifyOutput,
  missingNamedCases,
  passingTestTitles,
} from '../../scripts/gates/milestone-checks.mjs';
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
  const run = (author, reviewer, caught, diff_sha256 = author === 'claude' ? H1 : H2) => ({
    author,
    reviewer,
    seededDefect: 'off-by-one in fixture',
    diff_sha256,
    caught,
  });

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

  it('accepts an exit checklist tick after the range end: its box waits for CI evidence at that end (M16 final F17)', () => {
    const { sb, commit, baseline } = repo();
    try {
      commit('src/a.txt', 'M0.1: feat: a');
      const end = commit('src/b.txt', 'M0.2: feat: b');
      commit('docs/milestones/exits/R0.md', 'M0.3: docs(milestones): tick row 6 on the perf evidence');
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

describe('checkExitChecklist (NFR-DX-003, M16 final F13, F18)', () => {
  const row = (n, box, href = 'a.md') => `| ${n} | [${box}] criterion ${n}. | [evidence](${href}) |`;
  const table = (...rows) => ['# R9 exit checklist', '', '| # | Criterion | Evidence |', '|---|---|---|', ...rows].join('\n');
  const opts = { from: 1, to: 2, min: 2, resolves: (href) => href !== 'dead.md' };

  it("passes when the milestone's rows are ticked with live links, whatever later rows say", () => {
    assert.equal(checkExitChecklist(table(row(1, 'x'), row(2, 'x'), row(3, ' ', 'dead.md')), opts), true);
  });

  it('names an open box, a dead link and too few rows among its own rows', () => {
    assert.equal(checkExitChecklist(table(row(1, 'x'), row(2, ' ')), opts), 'unticked rows: 2');
    assert.match(String(checkExitChecklist(table(row(1, 'x'), row(2, 'x', 'dead.md')), opts)), /resolve to nothing: dead\.md/);
    assert.match(String(checkExitChecklist(table(row(1, 'x'), row(3, 'x')), opts)), /only 1 checklist rows/);
  });
});

describe('checkBacklogDone (NFR-DX-003, M0 cp2 F1)', () => {
  const row = (id, state) => `| ${id} | task | NFR-DX-003 | WHEN x THE SYSTEM SHALL y | — | ${state} | |`;
  const backlog = (...rows) => `# Backlog\n\n| ID | Task | Req | Acceptance | Deps | State | Commit |\n|---|---|---|---|---|---|---|\n${rows.join('\n')}\n`;

  it('accepts when every row is done and reopened targets are done', () => {
    const reviews = [
      {
        checkpoint: 'cp1',
        dispositions: [
          { finding: 'F1', disposition: 'reopen', target: 'M0.2' },
          { finding: 'F2', disposition: 'hand-off', target: 'M1' },
        ],
      },
    ];
    const files = {
      'docs/milestones/M1.md': '# M1\n\n| 9 | the handed-off task (M0 cp1 F2) | HARNESS | x |\n',
      'docs/milestones/roadmap.md':
        '# Roadmap\n\n## Deferred into a later milestone\n\n| Item | From | To | Why |\n|---|---|---|---|\n| the task | M0 | M1 | cp1 F2: later |\n',
    };
    const read = (path) => files[path] ?? null;
    assert.equal(checkBacklogDone(backlog(row('M0.1', 'done'), row('M0.2', 'done')), 'M0', reviews, { read, handOffsFrom: 0 }), true);
  });

  it('a hand-off without a target row is refused, in the receiving plan or the roadmap Deferred table (M18 final F2)', () => {
    const done = `${backlog(row('M0.1', 'done'))}${row('M1.1', 'done')}\n`;
    const reviews = [{ checkpoint: 'cp4', dispositions: [{ finding: 'F3', disposition: 'hand-off', target: 'M2' }] }];
    const plan = '# M2\n\n| 7 | handed-off task (M0 cp4 F3) | HARNESS | x |\n';
    const roadmap = (row) =>
      `# Roadmap\n\n## Deferred into a later milestone\n\n| Item | From | To | Why |\n|---|---|---|---|\n${row}\n\n## Later\n\n| cp4 F3 | M2 |\n`;
    const reader = (files) => (path) => files[path] ?? null;
    const ok = { 'docs/milestones/M2.md': plan, 'docs/milestones/roadmap.md': roadmap('| the task | M0 | M2 | cp4 F3: later |') };
    assert.equal(checkBacklogDone(done, 'M0', reviews, { read: reader(ok), handOffsFrom: 0 }), true);
    // no row in the receiving plan (a prose mention or a different finding does not count)
    for (const text of ['# M2\n\nM0 cp4 F3 is mentioned in prose only.\n', '# M2\n\n| 7 | other (M0 cp4 F30) | x |\n'])
      assert.match(
        String(checkBacklogDone(done, 'M0', reviews, { read: reader({ ...ok, 'docs/milestones/M2.md': text }), handOffsFrom: 0 })),
        /cp4 F3: hand-off to M2 has no row in docs\/milestones\/M2\.md citing 'M0 cp4 F3'/,
      );
    assert.match(
      String(checkBacklogDone(done, 'M0', reviews, { read: reader({ ...ok, 'docs/milestones/M2.md': undefined }), handOffsFrom: 0 })),
      /has no docs\/milestones\/M2\.md/,
    );
    // no Deferred row: a row outside the Deferred section, or one naming another milestone, does not count
    for (const deferredRow of ['| unrelated | M0 | M3 | cp9 F1 |', '| the task | M0 | M3 | cp4 F3: later |'])
      assert.match(
        String(checkBacklogDone(done, 'M0', reviews, { read: reader({ ...ok, 'docs/milestones/roadmap.md': roadmap(deferredRow) }), handOffsFrom: 0 })),
        /hand-off to M2 has no roadmap Deferred row citing 'cp4 F3'/,
      );
    // a hand-off to the human or an ADR names no milestone and is not checked here; the old spelling is not a hand-off
    const human = [{ checkpoint: 'cp5', dispositions: [{ finding: 'F1', disposition: 'hand-off', target: 'Huy (decision card) and ADR-0202' }] }];
    assert.equal(checkBacklogDone(done, 'M0', human, { read: reader({}), handOffsFrom: 0 }), true);
    // the citation names the reviewing milestone: another milestone's 'cp4 F3' row does not count (r1 F2)
    assert.match(
      String(
        checkBacklogDone(done, 'M0', reviews, { read: reader({ ...ok, 'docs/milestones/M2.md': '# M2\n\n| 7 | other (M1 cp4 F3) | x |\n' }), handOffsFrom: 0 }),
      ),
      /no row in docs\/milestones\/M2\.md citing 'M0 cp4 F3'/,
    );
    // only later milestones are targets: an earlier one the target follows up is not (r1 F2)
    const followUp = [{ checkpoint: 'cp4', dispositions: [{ finding: 'F3', disposition: 'hand-off', target: 'M2 (follows up M0 cp1 F1)' }] }];
    assert.equal(
      checkBacklogDone(done, 'M1', followUp, {
        read: reader({ ...ok, 'docs/milestones/M2.md': '# M2\n\n| 7 | x (M1 cp4 F3) |\n', 'docs/milestones/roadmap.md': roadmap('| t | M1 | M2 | cp4 F3 |') }),
        handOffsFrom: 0,
      }),
      true,
    );
    // from adoption on, a record in the old spelling is refused rather than skipped (r1 F1)
    for (const disposition of ['hand off', 'handoff'])
      assert.match(
        String(
          checkBacklogDone(done, 'M0', [{ checkpoint: 'cp1', dispositions: [{ finding: 'F1', disposition, target: 'M20' }] }], {
            read: reader({}),
            handOffsFrom: 0,
          }),
        ),
        new RegExp(`cp1 F1: disposition '${disposition}' is not one of`),
      );
    // before the adoption milestone (M19 by default) a missing target is not re-judged
    assert.equal(checkBacklogDone(done, 'M0', reviews, { read: reader({}) }), true);
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
      sb.write(
        '.harness/reviews/milestone-M0-cp3.json',
        JSON.stringify({ milestone: 'M0', checkpoint: 'cp3', dispositions: [{ finding: 'F1', disposition: 'reopen', target: 'M0.26' }] }),
      );
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

  it('rejects a descoped reason that cites neither an ADR nor the Deferred table (M0 final F1)', () => {
    assert.match(String(checkBacklogDone(`${row('M0.1', 'descoped (not feasible)')}\n`, 'M0')), /not done: M0\.1/);
    assert.equal(checkBacklogDone(`${row('M0.1', 'descoped (user decision; ADR-0137)')}\n`, 'M0'), true);
  });

  it('HARNESS: a later human supersede closes a reopened row descoped with a citation, and nothing less does (M12.27)', () => {
    const reopen = { checkpoint: 'cp1', dispositions: [{ finding: 'F3', disposition: 'reopen', target: 'M0.2' }] };
    const supersede = (note, extra = {}) => ({
      checkpoint: 'amend',
      dispositions: [{ finding: 'A1', disposition: 'supersede', supersedes: 'cp1 F3', target: 'M0.2', note, ...extra }],
    });
    const descoped = `${row('M0.1', 'done')}\n${row('M0.2', 'descoped (human decision; roadmap Deferred)')}\n`;
    assert.equal(checkBacklogDone(descoped, 'M0', [reopen, supersede('the human descoped it on 2026-10-07')]), true);
    // without the supersede the reopen still needs done
    assert.match(String(checkBacklogDone(descoped, 'M0', [reopen])), /reopened M0\.2 missing or not done/);
    // a supersede must name a real reopen of that row, cite the human, and the row must be closed with a citation
    assert.match(String(checkBacklogDone(descoped, 'M0', [reopen, supersede('the human', { supersedes: 'cp1 F9' })])), /names no reopen/);
    assert.match(String(checkBacklogDone(descoped, 'M0', [reopen, supersede('the human', { target: 'M0.1' })])), /names no reopen/);
    assert.match(String(checkBacklogDone(descoped, 'M0', [reopen, supersede('decided later')])), /cite the human/);
    const uncited = `${row('M0.1', 'done')}\n${row('M0.2', 'descoped (not now)')}\n`;
    assert.match(String(checkBacklogDone(uncited, 'M0', [reopen, supersede('the human')])), /not done: M0\.2|not closed/);
    // the supersede's own check: a reopen and a supersede of a row the backlog does not have (M12.27 review)
    const ghost = { checkpoint: 'cp1', dispositions: [{ finding: 'F4', disposition: 'reopen', target: 'M0.9' }] };
    const ghostSupersede = {
      checkpoint: 'amend',
      dispositions: [{ finding: 'A2', disposition: 'supersede', supersedes: 'cp1 F4', target: 'M0.9', note: 'the human' }],
    };
    assert.match(String(checkBacklogDone(descoped, 'M0', [reopen, supersede('the human'), ghost, ghostSupersede])), /not closed \(missing\)/);
  });

  it('rejects a bare descoped state and a descoped reopen target', () => {
    assert.match(String(checkBacklogDone(`${row('M0.1', 'descoped')}\n`, 'M0')), /not done: M0\.1/);
    const reviews = [{ checkpoint: 'cp9', dispositions: [{ finding: 'F1', disposition: 'reopen', target: 'M0.2' }] }];
    assert.match(String(checkBacklogDone(`${row('M0.2', 'descoped (later; ADR-0137)')}\n`, 'M0', reviews)), /reopened M0\.2 missing or not done/);
  });
});

describe('checkVerifyOutput and checkDistArtifacts (NFR-DX-002, M1 cp1 F1)', () => {
  const OUT = 'PASS typecheck (1ms)\nPASS lint (1ms)\nSKIP api — not written\nFAIL knip (2ms)\nVERIFY all: FAIL (1s)\n';

  it('accepts when every required step has a PASS line', () => {
    assert.equal(checkVerifyOutput(OUT, ['typecheck', 'lint']), true);
  });

  it('rejects absent, skipped and failed steps by name', () => {
    const r = String(checkVerifyOutput(OUT, ['typecheck', 'api', 'knip', 'publint']));
    assert.match(r, /api=SKIP/);
    assert.match(r, /knip=FAIL/);
    assert.match(r, /publint=absent/);
  });

  it('does not treat a longer step name as a match (size vs size-limit)', () => {
    assert.match(String(checkVerifyOutput('PASS size-limit (1ms)\n', ['size'])), /size=absent/);
  });

  it('requires dist/index.js and dist/index.d.ts for every library', () => {
    const present = new Set(['packages/a/dist/index.js', 'packages/a/dist/index.d.ts', 'packages/b/dist/index.js']);
    assert.equal(
      checkDistArtifacts(['packages/a'], (p) => present.has(p)),
      true,
    );
    assert.match(String(checkDistArtifacts(['packages/a', 'packages/b'], (p) => present.has(p))), /packages\/b\/dist\/index\.d\.ts/);
  });
});

describe('passingTestTitles (M1.23 review: named cases are leaf tests)', () => {
  it('ignores a describe whose title matches when its children do not', () => {
    const sb = sandbox([]);
    try {
      sb.write(
        'probe.test.mjs',
        "import { describe, it } from 'node:test';\ndescribe('skipIf group', () => { it('plain child', () => {}); });\nit('detects runIf', () => {});\n",
      );
      // node flags before the file, as namedCases runs it (args after the file go to the script)
      const r = spawnSync(process.execPath, ['--test-reporter=spec', '--test-name-pattern=skipIf', sb.path('probe.test.mjs')], {
        encoding: 'utf8',
        // under --test the child would otherwise report to the parent runner instead of printing spec output
        env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')),
      });
      assert.equal(r.status, 0, out(r));
      assert.deepEqual(passingTestTitles(r.stdout), ['plain child']);
      assert.equal(passingTestTitles(r.stdout).filter((t) => t.includes('skipIf')).length, 0);
    } finally {
      sb.cleanup();
    }
  });

  it('does not count todo or skipped cases as passing (M1.10 review F1)', () => {
    const sb = sandbox([]);
    try {
      sb.write(
        'probe.test.mjs',
        "import { it } from 'node:test';\nit('todo skipIf case', { todo: true }, () => {});\nit('skipped skipIf case', { skip: true }, () => {});\n",
      );
      const r = spawnSync(process.execPath, ['--test-reporter=spec', '--test-name-pattern=skipIf', sb.path('probe.test.mjs')], {
        encoding: 'utf8',
        env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')),
      });
      assert.match(r.stdout, /# TODO/, out(r));
      assert.deepEqual(passingTestTitles(r.stdout), []);
    } finally {
      sb.cleanup();
    }
  });

  it('returns leaf titles without their durations', () => {
    const spec = '▶ suite\n  ✔ fails on skipIf without a trailer (12.5ms)\n  ✖ broken (1ms)\n✔ suite (20ms)\nℹ pass 1\n';
    assert.deepEqual(passingTestTitles(spec), ['fails on skipIf without a trailer']);
  });
});

describe('changesetGaps (M5.3, M4 final F1)', () => {
  const workspaces = [
    { dir: 'packages/core', name: '@fluxion/core', private: false },
    { dir: 'packages/routing', name: '@fluxion/routing', private: false },
    { dir: 'apps/studio', name: '@fluxion/studio', private: true },
  ];
  it('a package changed in the range without a changeset fails', () => {
    const changed = ['packages/core/src/a.ts', 'packages/routing/package.json', 'apps/studio/src/App.tsx', 'docs/x.md'];
    assert.deepEqual(changesetGaps(changed, ["---\n'@fluxion/core': minor\n---\n"], workspaces), ['@fluxion/routing']);
    // named in double quotes counts too; private workspaces and non-shipped files need none
    assert.deepEqual(changesetGaps(changed, ["---\n'@fluxion/core': minor\n---\n", '---\n"@fluxion/routing": patch\n---\n'], workspaces), []);
    assert.deepEqual(changesetGaps(['packages/routing/README.md', 'packages/core/api/core.api.md'], [], workspaces), []);
    // a name in the prose is no release: only frontmatter lines count (review F2)
    assert.deepEqual(changesetGaps(['packages/core/src/a.ts'], ["---\n'@fluxion/cli': minor\n---\n\nNow uses '@fluxion/core' outlines.\n"], workspaces), [
      '@fluxion/core',
    ]);
  });

  it('a test file under src/ is no gap; a source file beside it and src/testing/ are (M18.272, cp44 F1)', () => {
    const layout = [{ dir: 'packages/layout', name: '@fluxion/layout', private: false }];
    assert.deepEqual(changesetGaps(['packages/layout/src/templates/templates.test.ts'], [], layout), []);
    assert.deepEqual(changesetGaps(['packages/layout/src/a.browser.test.tsx'], [], layout), []);
    assert.deepEqual(changesetGaps(['packages/layout/src/templates/templates.test.ts', 'packages/layout/src/templates/grid.ts'], [], layout), [
      '@fluxion/layout',
    ]);
    assert.deepEqual(changesetGaps(['packages/layout/src/testing/fixtures.ts'], [], layout), ['@fluxion/layout']);
    assert.deepEqual(changesetGaps(['packages/layout/src/test-utils.ts'], [], layout), ['@fluxion/layout']);
  });

  // every path a published workspace's files list ships counts besides dist (M19.5, M18 cp45 F5)
  const shipped = [
    { dir: 'packs/arrows', name: '@fluxion/pack-arrows', private: false, files: ['dist', 'pack', 'pack-versions.json'] },
    { dir: 'packages/dsl', name: '@fluxion/dsl', private: false, files: ['dist', 'grammar'] },
    { dir: 'packages/format', name: '@fluxion/format', private: false, files: ['dist', 'assets/font-engine/*.wasm', 'assets/font-engine/licenses'] },
    { dir: 'packs/fonts-core', name: '@fluxion/fonts-core', private: false, files: ['dist', 'fonts', 'fonts.json', 'OFL.txt'] },
  ];

  it('a pack-only change is a gap: a definition under pack/ ships though no src/ file changed (M19.5)', () => {
    assert.deepEqual(changesetGaps(['packs/arrows/pack/arrows/right.json'], [], shipped), ['@fluxion/pack-arrows']);
    assert.deepEqual(changesetGaps(['packs/arrows/pack-versions.json'], [], shipped), ['@fluxion/pack-arrows']);
    // dist is the build's, never a source change; a changeset naming the workspace covers it
    assert.deepEqual(changesetGaps(['packs/arrows/dist/index.js'], [], shipped), []);
    assert.deepEqual(changesetGaps(['packs/arrows/pack/arrows/right.json'], ["---\n'@fluxion/pack-arrows': patch\n---\n"], shipped), []);
  });

  it('a grammar change is a gap, and so are the other listed paths, globs kept within their segment (M19.5)', () => {
    assert.deepEqual(changesetGaps(['packages/dsl/grammar/fluxscript.ebnf'], [], shipped), ['@fluxion/dsl']);
    assert.deepEqual(changesetGaps(['packages/format/assets/font-engine/woff2-codec.wasm'], [], shipped), ['@fluxion/format']);
    assert.deepEqual(changesetGaps(['packages/format/assets/font-engine/build/notes.md', 'packages/format/assets/font-engine/x.wasm.map'], [], shipped), []);
    assert.deepEqual(changesetGaps(['packages/format/assets/font-engine/licenses/OFL.txt'], [], shipped), ['@fluxion/format']);
    assert.deepEqual(changesetGaps(['packs/fonts-core/fonts.json', 'packs/fonts-core/OFL.txt.bak'], [], shipped), ['@fluxion/fonts-core']);
    assert.deepEqual(changesetGaps(['packs/fonts-core/OFL.txt.bak', 'packs/fonts-core/fonts-old/a.woff2'], [], shipped), []);
    // ** spans segments, trailing or followed by a slash (r1 F1)
    const globbed = [{ dir: 'p/x', name: 'x', private: false, files: ['tpl/**', 'a/**/b.json'] }];
    for (const path of ['p/x/tpl/a.json', 'p/x/tpl/b/a.txt', 'p/x/a/b.json', 'p/x/a/c/d/b.json'])
      assert.deepEqual(changesetGaps([path], [], globbed), ['x'], path);
    for (const path of ['p/x/tplx/a.json', 'p/x/a/c/b.jsonx']) assert.deepEqual(changesetGaps([path], [], globbed), [], path);
  });

  it('a test file under src is none, with files lists read (M19.5)', () => {
    assert.deepEqual(changesetGaps(['packages/dsl/src/grammar.test.ts', 'packs/arrows/src/pack.test.ts'], [], shipped), []);
  });

  it('an older changeset does not cover a change of the range; one the range adds does (review F1)', () => {
    const sb = sandbox(['scripts', 'tools/gen'], { git: true });
    try {
      const commit = (path, text) => {
        sb.write(path, text);
        sb.git('add', path);
        sb.git('commit', '-q', '--no-verify', '-m', `M9.1: chore(x): ${path}`);
        return sb.git('rev-parse', 'HEAD').stdout.trim();
      };
      const base = commit('.changeset/old.md', "---\n'@fluxion/core': minor\n---\n\nOld.\n");
      commit('packages/core/src/a.ts', 'export const a = 1;\n');
      assert.match(inRepo(sb, `c.changesetsCoverRange('${base}')`), /no changeset for @fluxion\/core/);
      commit('.changeset/new.md', "---\n'@fluxion/core': minor\n---\n\nNew.\n");
      assert.equal(inRepo(sb, `c.changesetsCoverRange('${base}')`), true);
      // a file moved from core to routing changes both workspaces (review r2 F1)
      const moved = sb.git('rev-parse', 'HEAD').stdout.trim();
      sb.write('packages/routing/src/a.ts', 'export const a = 1;\n');
      sb.git('rm', '-q', 'packages/core/src/a.ts');
      sb.git('add', 'packages/routing/src/a.ts');
      sb.git('commit', '-q', '--no-verify', '-m', 'M9.2: chore(x): move');
      // git sees the identical file as a rename
      assert.match(sb.git('show', '--name-status', '--format=', 'HEAD').stdout, /^R100/m);
      commit('.changeset/move.md', "---\n'@fluxion/routing': minor\n---\n\nMoved.\n");
      assert.match(inRepo(sb, `c.changesetsCoverRange('${moved}')`), /no changeset for @fluxion\/core/);
    } finally {
      sb.cleanup();
    }
  });
});

describe('M5 legs made honest (M5 cp1 F4)', () => {
  it('readmeGaps rejects a stub, a heading alone and a README that names too little', async () => {
    const { readmeGaps } = await import('../../scripts/gates/milestone-checks.mjs');
    const full = [
      '# @fluxion/pack-basic',
      '',
      'The basic shapes:',
      '- basic:rect',
      '- basic:ellipse',
      'Register with definePack.',
      'More.',
      'Even more.',
      'Last line.',
    ].join('\n');
    assert.equal(readmeGaps(full, ['basic:rect', 'basic:ellipse']), true);
    assert.match(String(readmeGaps('# x\n\nstub (M1)\n', [])), /M1 stub/);
    assert.match(String(readmeGaps('# @fluxion/pack-basic\n', [])), /1 non-empty lines \(< 8\)/);
    assert.match(String(readmeGaps(full, ['basic:rect', 'basic:star', 'basic:cloud'])), /does not name basic:star, basic:cloud/);
  });

  it('propertyRuns reads the numRuns of the titled property, 0 when it relies on the default', async () => {
    const { propertyRuns } = await import('../../scripts/gates/milestone-checks.mjs');
    const src = [
      "it('A: first', () => { fc.assert(fc.property(x, f), { numRuns: 50 }); });",
      "it('FR-CON-012: after random transforms endpoints lie on anchors', () => {",
      '  fc.assert(fc.property(t, f), { numRuns: 1_000 });',
      '});',
      "it('C: other', () => { fc.assert(fc.property(x, f), { numRuns: 5000 }); });",
    ].join('\n');
    assert.equal(propertyRuns(src, 'FR-CON-012: after random transforms endpoints lie on anchors'), 1000);
    assert.equal(propertyRuns(src, 'A: first'), 50);
    // a property without numRuns runs fast-check's default: below the plan's 1 000
    assert.equal(propertyRuns("it('B', () => { fc.assert(fc.property(x, f)); });\nit('C', () => { fc.assert(p, { numRuns: 9000 }); });", 'B'), 0);
    assert.equal(propertyRuns(src, 'no such title'), 0);
    // the body ends at the next test or suite call in any style: a later property's runs do not count
    const loose = [
      "it('FR-CON-012: t', () => { fc.assert(fc.property(t, f)); });",
      "test('other', () => fc.assert(p, { numRuns: 5000 }));",
      'it("third", () => fc.assert(p, { numRuns: 7000 }));',
      "it.each([1])('fourth', () => fc.assert(p, { numRuns: 8000 }));",
      "describe('suite', () => { it('x', () => fc.assert(p, { numRuns: 9000 })); });",
    ];
    for (const next of loose.slice(1)) assert.equal(propertyRuns(`${loose[0]}\n${next}`, 'FR-CON-012: t'), 0, next);
    // the title in a comment, or inside another test, is not the test
    const commented = `// FR-CON-012: t runs a thousand times\nit('A', () => fc.assert(p, { numRuns: 3000 }));\ntest("FR-CON-012: t", () => fc.assert(p, { numRuns: 1200 }));`;
    assert.equal(propertyRuns(commented, 'FR-CON-012: t'), 1200);
    assert.equal(propertyRuns("it.skip('R (a+b)', () => fc.assert(p, { numRuns: 42 }));", 'R (a+b)'), 42);
    // a constant the file declares counts; any other expression cannot be read (M5.32 review F1)
    const named = "const RUNS = 1_500;\nit('N', () => fc.assert(p, { numRuns: RUNS }));";
    assert.equal(propertyRuns(named, 'N'), 1500);
    assert.ok(Number.isNaN(propertyRuns("it('N', () => fc.assert(p, { numRuns: runs() }));", 'N')));
    assert.ok(Number.isNaN(propertyRuns("it('N', () => fc.assert(p, { numRuns: MISSING }));", 'N')));
    // an expression is not its first operand (M5.23 review F1)
    assert.ok(Number.isNaN(propertyRuns("it('N', () => fc.assert(p, { numRuns: 5000 - 4999 }));", 'N')));
    assert.ok(Number.isNaN(propertyRuns(`${named.split('\n')[0]}\nit('N', () => fc.assert(p, { numRuns: RUNS / 100 }));`, 'N')));
    assert.equal(propertyRuns("it('N', () => fc.assert(p, { seed: 1, numRuns: 2_000 , verbose: true }));", 'N'), 2000);
    // a method named test inside the body does not end it (M5.32 review F2)
    assert.equal(propertyRuns("it('M', () => { if (/x/.test(s)) f(); fc.assert(p, { numRuns: 1200 }); });", 'M'), 1200);
  });

  it('coverageGaps fails a package under its floor or with too few statements', async () => {
    const { coverageGaps } = await import('../../scripts/gates/milestone-checks.mjs');
    const entry = (total, covered, btotal, bcovered) => ({
      statements: { total, covered },
      lines: { total, covered },
      branches: { total: btotal, covered: bcovered },
    });
    const summary = {
      'E:/repo/packs/basic/src/shapes/star.ts': entry(40, 40, 10, 10),
      'E:\\repo\\packs\\basic\\src\\index.ts': entry(30, 30, 4, 4),
      'E:/repo/packages/core/src/x.ts': entry(100, 0, 10, 0),
    };
    const floors = { lines: 90, branches: 85 };
    assert.equal(coverageGaps(summary, 'packs/basic', floors, 60), true);
    assert.match(String(coverageGaps(summary, 'packs/basic', floors, 100)), /70 statements \(< 100\)/);
    const low = { ...summary, 'E:/repo/packs/basic/src/shapes/cloud.ts': entry(30, 0, 10, 2) };
    assert.match(String(coverageGaps(low, 'packs/basic', floors, 60)), /packs\/basic: lines 70\.0%; branches 66\.7%/);
    assert.match(String(coverageGaps({}, 'packs/basic', floors, 1)), /0 statements/);
    // a package with no branches is not below a branch floor (M5.38): its statements still count
    const data = { 'E:/repo/packs/basic/src/shapes/rect.ts': entry(44, 44, 0, 0) };
    assert.equal(coverageGaps(data, 'packs/basic', floors, 40), true);
    assert.match(String(coverageGaps(data, 'packs/basic', floors, 60)), /^packs\/basic: 44 statements \(< 60\)$/);
  });
});

describe('M6 Playwright legs (M6.1)', () => {
  const report = (entries) => ({
    suites: [
      {
        file: 'editor.boot.spec.ts',
        specs: [{ title: 'boots', tests: entries.map(([projectName, status]) => ({ projectName, status })) }],
      },
    ],
  });

  it('checkPlaywrightReport needs every spec on every project, passed on its first run', async () => {
    const { checkPlaywrightReport } = await import('../../scripts/gates/milestone-checks.mjs');
    const all = [
      ['chromium', 'expected'],
      ['firefox', 'expected'],
      ['webkit', 'expected'],
    ];
    assert.equal(checkPlaywrightReport(report(all), ['e2e/editor.boot.spec.ts'], ['chromium', 'firefox', 'webkit']), true);
    // a project that ran nothing, a failure, and a pass on retry (flaky) all fail the leg
    assert.match(String(checkPlaywrightReport(report(all.slice(0, 2)), ['e2e/editor.boot.spec.ts'], ['chromium', 'webkit'])), /\[webkit\]: no test ran/);
    assert.match(String(checkPlaywrightReport(report([['chromium', 'unexpected']]), ['e2e/editor.boot.spec.ts'], ['chromium'])), /"boots": unexpected/);
    assert.match(String(checkPlaywrightReport(report([['chromium', 'flaky']]), ['e2e/editor.boot.spec.ts'], ['chromium'])), /"boots": flaky/);
    assert.match(String(checkPlaywrightReport(report([['chromium', 'skipped']]), ['e2e/editor.boot.spec.ts'], ['chromium'])), /skipped/);
    // another spec's tests do not count
    assert.match(
      String(checkPlaywrightReport(report(all), ['e2e/canvas.pan-zoom.spec.ts'], ['chromium'])),
      /canvas\.pan-zoom\.spec\.ts \[chromium\]: no test ran/,
    );
    // nested describe suites are walked, Windows paths normalised
    const nested = {
      suites: [{ file: 'e2e\\x.spec.ts', suites: [{ title: 'group', specs: [{ title: 't', tests: [{ projectName: 'chromium', status: 'expected' }] }] }] }],
    };
    assert.equal(checkPlaywrightReport(nested, ['e2e/x.spec.ts'], ['chromium']), true);
  });

  it('NFR-PORT-001 (M19.29): a failed Playwright leg names the studio boot report the test left, and only the image CLI keeps test-results', async () => {
    const { checkPlaywrightReport, checkPlaywrightTitles } = await import('../../scripts/gates/milestone-checks.mjs');
    const { dockerArgs } = await import('../../scripts/e2e/image.mjs');
    const note = { type: 'boot-phases', description: 'marks start@227; waiting on lock; now 25000' };
    const failed = (where) => ({
      suites: [{ file: 'editor.boot.spec.ts', specs: [{ title: 'boots', tests: [{ projectName: 'firefox', status: 'unexpected', ...where }] }] }],
    });
    // the reporter puts a runtime annotation on the run and on the test; either is read
    for (const report of [failed({ results: [{ annotations: [note] }] }), failed({ annotations: [note] })]) {
      assert.match(
        String(checkPlaywrightReport(report, ['e2e/editor.boot.spec.ts'], ['firefox'])),
        /"boots": unexpected \(studio boot: marks start@227; waiting on lock;/,
      );
      assert.match(
        String(checkPlaywrightTitles(report, 'e2e/editor.boot.spec.ts', ['boots'], ['firefox'])),
        /"boots": unexpected \(studio boot: marks start@227;/,
      );
    }
    // a failure with no boot report reads as before
    assert.match(String(checkPlaywrightReport(failed({}), ['e2e/editor.boot.spec.ts'], ['firefox'])), /"boots": unexpected$/);
    // the gates' runs (a report, no results) never ask the image for test-results; the CLI's --out does
    assert.ok(!dockerArgs(['x'], { report: '/tmp/g/report.json' }).includes('FLUXION_E2E_COPY_RESULTS=1'));
    assert.ok(dockerArgs(['x'], { out: '/tmp/o', results: true }).includes('FLUXION_E2E_COPY_RESULTS=1'));
  });

  it('M19.28: the cold-setup leg counts 3 readings after the row, by their median', async () => {
    const { checkColdReadings } = await import('../../scripts/gates/milestone-checks.mjs');
    // commits in order a < row < b < c < d, all on HEAD's history; x is off it
    const order = ['a', 'row', 'b', 'c', 'd', 'HEAD'];
    const isAncestor = (p, q) => order.includes(p) && order.includes(q) && order.indexOf(p) <= order.indexOf(q);
    const at = (sha, ms) => ({ sha, ms });
    const check = (readings, opts = {}) => checkColdReadings(readings, 'row', { isAncestor, ...opts });
    assert.equal(check([at('b', 400_000), at('c', 300_000), at('d', 430_000)]), true);
    // a reading before the row or off the branch does not count
    assert.match(
      String(check([at('a', 300_000), at('b', 300_000), at('c', 300_000)])),
      /^2 CI cold-setup reading\(s\) at or after row \(3 recorded\): 3 needed/,
    );
    assert.match(String(check([at('x', 300_000), at('b', 300_000), at('c', 300_000)])), /^2 CI cold-setup/);
    // the median, not the best or the latest reading
    assert.match(String(check([at('b', 300_000), at('c', 430_000), at('d', 440_000)])), /median cold setup 430000 ms over 3 readings > 420000/);
    assert.equal(check([at('b', 500_000), at('c', 300_000), at('d', 410_000), at('row', 420_000)]), true, 'an even count takes the middle two');
    assert.match(String(check(undefined)), /^0 CI cold-setup reading/);
    assert.match(String(checkColdReadings([], '', { isAncestor })), /no M19\.28 commit/);
  });

  it('M20.28: the cold-setup readings are every completed ci run since the first commit, read from the source', async () => {
    const { ciColdReadings } = await import('../../scripts/gates/milestone-checks.mjs');
    // commits in order old < first < a < b < c < HEAD; x is off HEAD's history
    const order = ['old', 'first', 'a', 'b', 'c', 'HEAD'];
    const isAncestor = (p, q) => order.includes(p) && order.includes(q) && order.indexOf(p) <= order.indexOf(q);
    const run = (databaseId, headSha, status = 'completed') => ({ databaseId, headSha, status });
    const colds = {
      1: { conclusion: 'success', ms: 1, log: 'budget: cold setup 300000 ms <= 600000 ms' },
      2: { conclusion: 'failure', ms: 450_000, log: '' },
      3: { conclusion: 'success', ms: 380_000, log: null },
      5: { conclusion: 'cancelled', ms: null, log: null },
      6: { conclusion: 'success', ms: 999_000, log: '' },
    };
    const pages = [[run(1, 'c'), run(9, 'c', 'in_progress'), run(2, 'b'), run(4, 'x'), run(5, 'a'), run(3, 'first'), run(6, 'old')]];
    const asked = [];
    const source = {
      ciPage: async (branch, page, size) => {
        asked.push([branch, page, size]);
        return pages[page - 1] ?? [];
      },
      coldSetup: async (id) => colds[id],
    };
    const readings = await ciColdReadings(source, 'first', { isAncestor });
    // check-budget's own measure wins; a failed cold-setup still has a duration; a pending, off-branch, cancelled or older run has none
    assert.deepEqual(readings, [
      { run: 1, sha: 'c', ms: 300_000 },
      { run: 2, sha: 'b', ms: 450_000 },
      { run: 3, sha: 'first', ms: 380_000 },
    ]);
    assert.deepEqual(asked, [['main', 1, 100]], 'a run older than the first commit ends the paging');
    // a full first page that reaches past the first commit is the last one read
    const full = [...Array.from({ length: 99 }, (_, i) => run(100 + i, 'a', 'in_progress')), run(6, 'old')];
    const fullAsked = [];
    const fullSource = {
      ciPage: async (_b, page) => {
        fullAsked.push(page);
        return full;
      },
      coldSetup: async () => undefined,
    };
    assert.deepEqual(await ciColdReadings(fullSource, 'first', { isAncestor }), []);
    assert.deepEqual(fullAsked, [1]);
    // a source with more runs than the pages read is refused, not cut short
    const endless = { ciPage: async () => Array.from({ length: 100 }, (_, i) => run(i, 'a')), coldSetup: async () => undefined };
    await assert.rejects(ciColdReadings(endless, 'first', { isAncestor, pages: 2 }), /more than 200 ci runs since first/);
  });

  it('M20.28: the cold-setup median takes the higher middle reading on an even count, and an unreadable one fails', async () => {
    const { checkColdMedian } = await import('../../scripts/gates/milestone-checks.mjs');
    const at = (ms, run = 1) => ({ run, sha: 'a', ms });
    assert.equal(checkColdMedian([at(300_000), at(420_000), at(500_000)], 420_000), true);
    assert.match(String(checkColdMedian([at(300_000), at(430_000), at(500_000)], 420_000)), /median cold setup 430000 ms over 3 ci runs > 420000/);
    // 410 and 430 in the middle: the higher one judges, so a tie never rounds the median down
    assert.match(String(checkColdMedian([at(300_000), at(410_000), at(430_000), at(500_000)], 420_000)), /median cold setup 430000 ms/);
    assert.equal(checkColdMedian([at(300_000), at(410_000), at(415_000), at(500_000)], 420_000), true);
    assert.match(String(checkColdMedian([at(300_000), at(null, 7)], 420_000)), /unreadable in run\(s\) 7/);
    assert.equal(checkColdMedian([], 420_000), 'no ci cold-setup readings');
  });

  it('M19.58: the browser legs of a gate share one Playwright run, each judged on its own specs', async () => {
    const { sharedPlaywright } = await import('../../scripts/gates/milestone-checks.mjs');
    const a = 'e2e/locks.spec.ts';
    const b = 'e2e/style-paint.spec.ts';
    const calls = [];
    const runner = (args, env) => {
      calls.push(args);
      // locks passes on both engines; style-paint fails on firefox
      const tests = (file, statuses) => ({ file, specs: [{ title: 't', tests: statuses.map(([projectName, status]) => ({ projectName, status })) }] });
      const suites = [
        tests('locks.spec.ts', [
          ['chromium', 'expected'],
          ['firefox', 'expected'],
        ]),
        tests('style-paint.spec.ts', [
          ['chromium', 'expected'],
          ['firefox', 'unexpected'],
        ]),
      ];
      writeFileSync(env.PLAYWRIGHT_JSON_OUTPUT_NAME, JSON.stringify({ suites }));
      return { status: 1, stdout: '', stderr: '' };
    };
    let asked = 0;
    const shared = sharedPlaywright([a, b], ['chromium', 'firefox'], {
      runner: () => {
        asked++;
        return runner;
      },
    });
    assert.equal(asked, 0, 'no runner is asked for before a leg runs');
    assert.equal(shared([a]), true);
    assert.match(String(shared([b])), /style-paint\.spec\.ts \[firefox\] "t": unexpected/);
    // one run over both specs, however many legs ask
    assert.equal(calls.length, 1);
    assert.equal(asked, 1);
    assert.deepEqual(
      calls[0].filter((x) => x.startsWith('e2e/')),
      [a, b],
    );
    // a spec outside the shared run, or missing from the tree, fails its leg without another run
    assert.match(String(shared(['e2e/table.edit.spec.ts'])), /not in the gate's shared Playwright run: e2e\/table\.edit\.spec\.ts/);
    assert.match(String(shared(['e2e/no-such.spec.ts'])), /missing e2e\/no-such\.spec\.ts/);
    assert.equal(calls.length, 1);
  });

  it('checkPlaywrightTitles needs each title passed on its first run on every project, in that spec', async () => {
    const { checkPlaywrightTitles } = await import('../../scripts/gates/milestone-checks.mjs');
    const titled = (file, specs) => ({ suites: [{ file, specs: specs.map(([title, projectName, status]) => ({ title, tests: [{ projectName, status }] })) }] });
    const spec = 'e2e/parity.edit-vs-present.spec.ts';
    const both = [
      ['pixels', 'chromium', 'expected'],
      ['dom', 'chromium', 'expected'],
    ];
    assert.equal(checkPlaywrightTitles(titled('parity.edit-vs-present.spec.ts', both), spec, ['pixels', 'dom'], ['chromium']), true);
    // a missing title, a missing project, a failure or a retry, and another spec's test all fail
    assert.match(
      String(checkPlaywrightTitles(titled('parity.edit-vs-present.spec.ts', both.slice(0, 1)), spec, ['pixels', 'dom'], ['chromium'])),
      /\[chromium\]: no test titled "dom"/,
    );
    assert.match(
      String(checkPlaywrightTitles(titled('parity.edit-vs-present.spec.ts', both), spec, ['pixels'], ['chromium', 'webkit'])),
      /\[webkit\]: no test titled "pixels"/,
    );
    assert.match(
      String(checkPlaywrightTitles(titled('parity.edit-vs-present.spec.ts', [['pixels', 'chromium', 'flaky']]), spec, ['pixels'], ['chromium'])),
      /"pixels": flaky/,
    );
    assert.match(String(checkPlaywrightTitles(titled('other.spec.ts', both), spec, ['pixels'], ['chromium'])), /no test titled "pixels"/);
    // a title must match whole: a longer title does not stand in for it
    assert.match(
      String(checkPlaywrightTitles(titled('parity.edit-vs-present.spec.ts', [['pixels too', 'chromium', 'expected']]), spec, ['pixels'], ['chromium'])),
      /no test titled/,
    );
    // at most six reasons, then a count
    const many = Array.from({ length: 8 }, (_, i) => `t${i}`);
    assert.match(String(checkPlaywrightTitles(titled('parity.edit-vs-present.spec.ts', []), spec, many, ['chromium'])), /; … 2 more$/);
  });

  it('vitestTitles with exact matches a whole title: a suffixed or prefixed test no longer counts (M12.50)', async () => {
    const { vitestTitles } = await import('../../scripts/gates/milestone-checks.mjs');
    const report = (titles) => (args) => {
      const out = args.find((a) => a.startsWith('--outputFile=')).slice('--outputFile='.length);
      const assertionResults = titles.map((title) => ({ title, fullName: `suite ${title}`, status: 'passed' }));
      writeFileSync(out, JSON.stringify({ testResults: [{ assertionResults }] }));
      return { status: 0, stdout: '', stderr: '' };
    };
    const t = 'FR-X-001: it works';
    assert.deepEqual(vitestTitles([t], ['p'], { runner: report([t]), exact: true }), [true]);
    for (const other of [`${t} (renamed)`, `regression ${t}`, `FR-X-001: now it works`]) {
      assert.match(String(vitestTitles([t], ['p'], { runner: report([other]), exact: true })[0]), /0 passing test\(s\), need 1/);
    }
    // without exact (the gates before M12) a suffixed title still counts
    assert.deepEqual(vitestTitles([t], ['p'], { runner: report([`${t} (renamed)`]) }), [true]);
  });

  it('playwrightSpecs refuses a missing spec and judges the report the runner writes', async () => {
    const { playwrightSpecs } = await import('../../scripts/gates/milestone-checks.mjs');
    assert.match(String(playwrightSpecs(['e2e/no-such.spec.ts'], ['chromium'])), /missing e2e\/no-such\.spec\.ts/);
    const spec = 'e2e/smoke.studio-boots.spec.ts';
    let seen;
    const runner = (args, env) => {
      seen = args;
      writeFileSync(
        env.PLAYWRIGHT_JSON_OUTPUT_NAME,
        JSON.stringify({ suites: [{ file: 'smoke.studio-boots.spec.ts', specs: [{ title: 's', tests: [{ projectName: 'chromium', status: 'expected' }] }] }] }),
      );
      return { status: 0, stdout: '', stderr: '' };
    };
    assert.equal(playwrightSpecs([spec], ['chromium'], { runner }), true);
    assert.deepEqual(seen, [spec, '--project=chromium', '--reporter=json']);
    // a measuring run takes the workers it is given (the perf group: one)
    const { playwrightReport } = await import('../../scripts/gates/milestone-checks.mjs');
    assert.notEqual(typeof playwrightReport([spec], ['perf'], { runner, workers: 1 }), 'string');
    assert.deepEqual(seen, [spec, '--project=perf', '--workers=1', '--reporter=json']);
    assert.match(String(playwrightSpecs([spec], ['chromium'], { runner: () => ({ status: 1, stdout: '', stderr: 'boom' }) })), /wrote no report: boom/);
  });

  it('a Playwright leg that ran no test names why, once: the report error, else the runner tail (M18.179, cp23 F3)', async () => {
    const { checkPlaywrightReport, checkPlaywrightTitles, playwrightSpecs } = await import('../../scripts/gates/milestone-checks.mjs');
    const spec = 'e2e/smoke.studio-boots.spec.ts';
    const webServer = {
      suites: [],
      errors: [{ message: '\x1b[31mError: Process from config.webServer was not able to start. Exit code: 1\x1b[39m\n    at stack line' }],
    };
    const why = String(checkPlaywrightReport(webServer, [spec], ['chromium', 'firefox']));
    assert.match(
      why,
      /\[chromium\]: no test ran; .*\[firefox\]: no test ran \(playwright: Error: Process from config\.webServer was not able to start\. Exit code: 1\)$/,
    );
    assert.equal(why.match(/playwright:/g).length, 1, 'once for the leg');
    assert.doesNotMatch(why, /stack line/);
    assert.ok(!why.includes(String.fromCharCode(27)), 'ANSI colours stripped');
    assert.match(String(checkPlaywrightTitles(webServer, spec, ['s'], ['chromium'])), /no test titled "s" \(playwright: Error: Process from config\.webServer/);
    // no error in the report: the runner's output tail
    const runner = (_args, env) => {
      writeFileSync(env.PLAYWRIGHT_JSON_OUTPUT_NAME, JSON.stringify({ suites: [] }));
      return { status: 1, stdout: '', stderr: 'pnpm: ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND' };
    };
    assert.match(String(playwrightSpecs([spec], ['chromium'], { runner })), /no test ran \(playwright: pnpm: ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND\)/);
    // a failed test is its own cause: nothing appended
    const failed = {
      suites: [{ file: 'smoke.studio-boots.spec.ts', specs: [{ title: 's', tests: [{ projectName: 'chromium', status: 'unexpected' }] }] }],
      errors: [{ message: 'x' }],
    };
    assert.doesNotMatch(String(checkPlaywrightReport(failed, [spec], ['chromium'])), /playwright:/);
  });
});

describe('the NFR-I18N-001 legs of m11-complete (M11.75, NFR-I18N-001)', () => {
  const rows = (...pairs) => pairs.map(([id, state]) => `| ${id} | text | NFR-I18N-001 | accept | dep | ${state} | |`).join('\n');

  it('NFR-I18N-001: checkRowsDone passes when every named row is done, whichever milestone it is in', () => {
    assert.equal(
      checkRowsDone(rows(['M9.19', 'done'], ['M9.20', 'done'], ['M11.71', 'done'], ['M11.72', 'done']), ['M9.19', 'M9.20', 'M11.71', 'M11.72']),
      true,
    );
  });

  it('NFR-I18N-001: checkRowsDone fails for a row that is not done, a missing row, and an uncited descope', () => {
    const text = rows(['M9.19', 'done'], ['M9.20', 'todo'], ['M11.71', 'descoped (later)']);
    assert.match(String(checkRowsDone(text, ['M9.19', 'M9.20'])), /M9\.20 \(todo\)/);
    assert.match(String(checkRowsDone(text, ['M11.72'])), /M11\.72 \(no such row\)/);
    assert.match(String(checkRowsDone(text, ['M11.71'])), /M11\.71 \(descoped \(later\)\)/);
    assert.equal(checkRowsDone(rows(['M11.71', 'descoped (Deferred: roadmap)']), ['M11.71']), true);
  });

  it('NFR-I18N-001: checkAllowlistEmpty fails for an entry, a missing file and a file without entries', () => {
    assert.equal(checkAllowlistEmpty({ globs: ['**/*.test.tsx'], entries: [] }), true);
    assert.match(String(checkAllowlistEmpty({ entries: [{ file: 'a.tsx', text: 'x', reason: 'r' }] })), /still lists 1 literal/);
    assert.match(String(checkAllowlistEmpty(null)), /missing or has no `entries`/);
    assert.match(String(checkAllowlistEmpty({ globs: [] })), /missing or has no `entries`/);
  });
});

describe('checkRowsTitled (NFR-DX-003, M12 cp1 F1)', () => {
  const row = (id, acceptance, state = 'done') => `| ${id} | task | FR-DSL-001 | ${acceptance} | — | ${state} | |`;
  const backlog = (...rows) => `| ID | Task | Req | Acceptance | Deps | State | Commit |\n|---|---|---|---|---|---|---|\n${rows.join('\n')}\n`;
  const text = backlog(
    row('M12.8', 'T0: every construct parses with its line and column'),
    row('M12.21', 'T1 `completion.browser.test.ts`: the list holds every shape'),
    row('M12.16', 'property `roundtrip.prop.test.ts` (fixed numRuns)'),
    row('M12.18', 'T0: never a half screen', 'todo'),
    row('M12.1', 'the gate prints every leg'),
    row('M12.31', 'CLI e2e: a `.flux` converts'),
  );
  const lists = [
    [['M12.8', 'FR-DSL-001: every construct parses with its line and column', 'dsl']],
    [['M12.21', 'FR-DSL-009: completion lists every shape', 'dsl', {}, 'browser']],
  ];
  const exempt = { 'M12.16': 'the round-trip property leg runs it' };

  it('HARNESS: a done row whose acceptance names a T0 or T1 test has a title in some leg, or a reasoned exemption (M12.45)', () => {
    assert.equal(checkRowsTitled(text, 'M12', lists, exempt), true);
  });

  it('HARNESS: a done T0, T1 or *.test.ts row with no title and no exemption fails, naming the row (M12.45)', () => {
    assert.match(String(checkRowsTitled(text, 'M12', [lists[1]], exempt)), /M12\.8/);
    assert.match(String(checkRowsTitled(text, 'M12', lists, {})), /no title in any leg: M12\.16/);
    assert.match(String(checkRowsTitled(text, 'M12', [lists[0]], exempt)), /M12\.21/);
    // rows not done, not tested at T0/T1 (HARNESS, CLI e2e) are not asked for
    assert.doesNotMatch(String(checkRowsTitled(text, 'M12', [], exempt)), /M12\.(18|1|31)\b/);
  });

  it('HARNESS: exemptions need a reason and a row, and a title must name a row of the backlog (M12.45)', () => {
    assert.match(String(checkRowsTitled(text, 'M12', lists, { ...exempt, 'M12.8': '' })), /exemption of M12\.8 gives no reason/);
    assert.match(String(checkRowsTitled(text, 'M12', lists, { ...exempt, 'M12.99': 'gone' })), /exemption names no row: M12\.99/);
    assert.match(String(checkRowsTitled(text, 'M12', [...lists, [['M12.98', 'x', 'dsl']]], exempt)), /a title names no row: M12\.98/);
    assert.match(String(checkRowsTitled('# empty\n', 'M12', lists, exempt)), /no M12 rows/);
  });
});

// M19.52, cp6 F1: the decodePng leg reads a recorded nightly png-check; a workflow that holds the job is not evidence
describe('checkPngEvidence (M19.52)', () => {
  const green = { run: 1, sha: 'a'.repeat(40), workflow: 'nightly', job: 'png-check', conclusion: 'success' };
  const ancestry = { isAncestor: () => true };
  it('NFR-DX-003: a green nightly png-check on a commit at or after 819cfaf on this branch passes the leg', () => {
    assert.equal(checkPngEvidence(green, ancestry), true);
  });
  it('NFR-DX-003: a red png-check fails the leg, as do no record, another job and a commit before 819cfaf or off this branch', () => {
    assert.match(String(checkPngEvidence({ ...green, conclusion: 'failure' }, ancestry)), /png-check concluded failure/);
    assert.match(String(checkPngEvidence(undefined, ancestry)), /no nightly png-check recorded/);
    assert.match(String(checkPngEvidence({ ...green, job: 'perf' }, ancestry)), /not nightly \/ png-check/);
    assert.match(String(checkPngEvidence({ ...green, workflow: 'ci' }, ancestry)), /not nightly \/ png-check/);
    assert.match(String(checkPngEvidence(green, { isAncestor: (a) => a !== '819cfaf' })), /before 819cfaf/);
    assert.match(String(checkPngEvidence(green, { isAncestor: (_a, b) => b !== 'HEAD' })), /not an ancestor of HEAD/);
  });
  it('NFR-DX-003: a nightly read through gh api pages, after gh run view is refused, is recorded green (M19.55, cp7 F2)', async () => {
    const { ghSource } = await import('../../scripts/gates/ci-runs.mjs');
    const sb = sandbox(['scripts'], { git: true });
    try {
      // the nightly's png-check job at a commit after 819cfaf (a ref of that name in the fixture's history)
      sb.git('tag', '819cfaf');
      sb.write(
        '.github/workflows/nightly.yml',
        "jobs:\n  png-check:\n    env:\n      FLUXION_PNG_CHECK: '1'\n    steps:\n      - run: pnpm exec playwright test e2e/x.spec.ts --retries=0\n",
      );
      sb.git('add', '-A');
      sb.git('commit', '-q', '-m', 'nightly', '--no-verify');
      const sha = sb.git('rev-parse', 'HEAD').stdout.trim();
      const page1 = Array.from({ length: 100 }, (_, i) => ({ id: 1000 + i, name: `visual (${i})`, conclusion: 'failure', steps: [] }));
      const answers = {
        'repos/huyz0/fluxion/actions/runs/9': { id: 9, name: 'nightly', head_sha: sha, conclusion: 'failure' },
        'repos/huyz0/fluxion/actions/runs/9/jobs?per_page=100': { jobs: page1 },
        'repos/huyz0/fluxion/actions/runs/9/jobs?per_page=100&page=2': { jobs: [{ id: 2000, name: 'png-check', conclusion: 'success', steps: [] }] },
      };
      const gh = ghSource((_cmd, args) =>
        args[0] === 'run'
          ? { status: 1, stdout: '', stderr: 'HTTP 403: Numeric-ID repository paths' }
          : { status: 0, stdout: JSON.stringify(answers[args[1]]) },
      );
      sb.write('runs.json', JSON.stringify([await gh.view(9)]));
      const r = sb.node('scripts/gates/check-png-evidence.mjs', ['--record', '9', '--runs-file', sb.path('runs.json'), '--file', sb.path('ev.json')]);
      assert.equal(r.status, 0, out(r));
      assert.equal(sb.node('scripts/gates/check-png-evidence.mjs', ['--file', sb.path('ev.json')]).status, 0);
      const { run, sha: at, job, conclusion } = JSON.parse(sb.read('ev.json'));
      assert.deepEqual({ run, at, job, conclusion }, { run: 9, at: sha, job: 'png-check', conclusion: 'success' });
    } finally {
      sb.cleanup();
    }
  });

  it('NFR-DX-003: check-png-evidence --record refuses a red nightly and writes no record', () => {
    const sb = sandbox(['scripts'], { git: true });
    try {
      const sha = sb.git('rev-parse', 'HEAD').stdout.trim();
      sb.write(
        'runs.json',
        JSON.stringify([{ databaseId: 7, workflowName: 'nightly', headSha: sha, conclusion: 'failure', jobs: [{ name: 'png-check', conclusion: 'failure' }] }]),
      );
      const r = sb.node('scripts/gates/check-png-evidence.mjs', ['--record', '7', '--runs-file', sb.path('runs.json'), '--file', sb.path('ev.json')]);
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, /png-check concluded failure/);
      assert.equal(sb.node('scripts/gates/check-png-evidence.mjs', ['--file', sb.path('ev.json')]).status, 1);
    } finally {
      sb.cleanup();
    }
  });
});

describe('m20-complete helpers (M20.30, cp2 F2)', () => {
  const named = 'FR-THM-005: an image palette holds its AA pairs';
  it('NFR-DX-003: a named case passes only under its whole title, not inside a longer one or when it failed', () => {
    assert.deepEqual(missingNamedCases([{ title: named, status: 'passed' }], [named]), []);
    assert.deepEqual(missingNamedCases([{ title: `${named} in dark mode`, status: 'passed' }], [named]), [named]);
    assert.deepEqual(missingNamedCases([{ title: `x ${named}`, status: 'passed' }], named), [named]);
    assert.deepEqual(missingNamedCases([{ title: named, status: 'skipped' }], [named]), [named]);
    assert.deepEqual(missingNamedCases([{ title: 'a', status: 'passed' }], ['a', 'b']), ['b']);
  });

  const backlog = [
    '| M20.5 | ADR | FR-THM-005 | ... | T0 | done | 1111111 |',
    '| M20.6 | Image palette | FR-THM-005 | ... | T0 | done | 2222222 |',
    '| M20.7 | Variants | FR-THM-006 | ... | T0 | todo | |',
  ].join('\n');
  const after = (descendants) => (a, b) => a === 'aaaaaaa' && descendants.includes(b);
  it('NFR-DX-003: an ADR passes only when every governed row with a Commit cell descends from the commit that added it', () => {
    const rows = ['M20.5', 'M20.6', 'M20.7'];
    assert.equal(checkAdrBeforeRows(backlog, rows, { number: '0055', added: 'aaaaaaa', isAncestor: after(['1111111', '2222222']) }), true);
    assert.equal(
      checkAdrBeforeRows(backlog, rows, { number: '0055', added: 'aaaaaaa', isAncestor: after(['1111111']) }),
      'M20.6 (2222222) was committed before ADR-0055',
    );
    assert.equal(checkAdrBeforeRows(backlog, rows, { number: '0055', added: undefined, isAncestor: () => true }), 'ADR-0055 is not committed');
  });
  it('NFR-DX-003: a governed row with no Commit cell yet is left to check-digest, and the ancestry check runs in real git', () => {
    const asked = [];
    const probe = (_a, b) => {
      asked.push(b);
      return true;
    };
    assert.equal(checkAdrBeforeRows(backlog, ['M20.7'], { number: '0055', added: 'aaaaaaa', isAncestor: probe }), true);
    assert.deepEqual(asked, []);
    const sb = sandbox(['scripts'], { git: true });
    try {
      const first = sb.git('rev-parse', 'HEAD').stdout.trim();
      sb.write('b.txt', '2');
      sb.git('add', '-A');
      sb.git('commit', '-q', '--no-verify', '-m', 'second');
      const second = sb.git('rev-parse', 'HEAD').stdout.trim();
      const rows = `| M20.6 | x | y | z | T0 | done | ${first.slice(0, 7)} |`;
      assert.equal(inRepo(sb, `c.checkAdrBeforeRows(${JSON.stringify(rows)}, ['M20.6'], { number: '0055', added: '${first}' })`), true);
      assert.equal(
        inRepo(sb, `c.checkAdrBeforeRows(${JSON.stringify(rows)}, ['M20.6'], { number: '0055', added: '${second}' })`),
        `M20.6 (${first.slice(0, 7)}) was committed before ADR-0055`,
      );
    } finally {
      sb.cleanup();
    }
  });
});
