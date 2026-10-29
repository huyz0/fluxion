// NFR-DX-003 HARNESS: checkpoint cadence is enforced against real index/commit history.
import assert from 'node:assert/strict';
import { chmodSync, rmSync } from 'node:fs';
import { describe, it } from 'node:test';
import { out, sandbox } from './helpers.mjs';

const POLICY = 'scripts/gates/check-checkpoint.mjs';
const REVIEW = '.harness/reviews/milestone-M18-cp1.json';
const roadmap = (milestone) => `# Roadmap\n\n**Current milestone: \`${milestone}\`**\n`;
const git = (sb, ...args) => {
  const result = sb.git(...args);
  assert.equal(result.status, 0, out(result));
  return result.stdout.trim();
};
function history(count = 8, { legacy = false } = {}) {
  const sb = sandbox(['scripts']);
  const policy = sb.read(POLICY);
  if (legacy) rmSync(sb.path(POLICY));
  sb.write('docs/milestones/roadmap.md', roadmap('M18'));
  sb.write('docs/backlog/current.md', Array.from({ length: 20 }, (_, i) => `| M18.${i + 1} | task | HARNESS | acceptance | | done | |`).join('\n'));
  sb.write('.gitignore', '.harness/tmp/\n');
  git(sb, 'init', '-q', '-b', 'main');
  git(sb, 'config', 'user.name', 'checkpoint-test');
  git(sb, 'config', 'user.email', 'checkpoint@example.invalid');
  git(sb, 'config', 'gc.auto', '0');
  git(sb, 'config', 'maintenance.auto', 'false');
  git(sb, 'config', 'core.autocrlf', 'false');
  git(sb, 'add', '.');
  git(sb, 'commit', '-qm', 'fixture baseline');
  const baseline = git(sb, 'rev-parse', 'HEAD');
  const commits = [];
  for (let i = 1; i <= count; i++) {
    sb.write('work.txt', `task ${i}\n`);
    git(sb, 'add', 'work.txt');
    git(sb, 'commit', '-qm', `M18.${i}: test(harness): exercise checkpoint history`);
    commits.push(git(sb, 'rev-parse', 'HEAD'));
  }
  if (legacy) sb.write(POLICY, policy);
  return { sb, baseline, commits };
}
function record(fixture, { end = fixture.commits.at(-1), milestone = 'M18', stage = true, fields = {} } = {}) {
  const review = {
    milestone,
    checkpoint: 'cp1',
    range: `${fixture.baseline}..${end}`,
    reviewer: 'independent:test',
    findings: [],
    dispositions: [],
    planDelta: '',
    ...fields,
  };
  fixture.sb.write(REVIEW, JSON.stringify(review));
  if (stage) git(fixture.sb, 'add', REVIEW);
}
function pending(sb, subject = 'M18.9: test(harness): next task') {
  sb.write('.harness/tmp/message', subject);
  return sb.node(POLICY, ['--message', sb.path('.harness/tmp/message')]);
}

describe('HARNESS NFR-DX-003: checkpoint cadence', () => {
  it('refuses a task after the checkpoint limit', () => {
    const f = history();
    try {
      const result = pending(f.sb);
      assert.equal(result.status, 1, out(result));
      assert.match(out(result), /8.*unreviewed|unreviewed.*8/);
    } finally {
      f.sb.cleanup();
    }
  });

  it('allows the eighth task before requiring a checkpoint for the ninth', () => {
    const f = history(7);
    try {
      const result = pending(f.sb);
      assert.equal(result.status, 0, out(result));
    } finally {
      f.sb.cleanup();
    }
  });

  it('stale checkpoint does not clear the limit', () => {
    const f = history(16);
    try {
      record(f, { end: f.commits[7] });
      const result = pending(f.sb);
      assert.equal(result.status, 1, out(result));
    } finally {
      f.sb.cleanup();
    }
  });

  it('covering checkpoint clears the limit', () => {
    const f = history();
    try {
      record(f);
      const result = pending(f.sb);
      assert.equal(result.status, 0, out(result));
    } finally {
      f.sb.cleanup();
    }
  });

  it('wrong-milestone and unstaged reviews cannot clear the limit', () => {
    const f = history();
    try {
      record(f, { milestone: 'M17' });
      assert.equal(pending(f.sb).status, 1);
      git(f.sb, 'reset', '--', REVIEW);
      record(f, { stage: false });
      assert.equal(pending(f.sb).status, 1);
    } finally {
      f.sb.cleanup();
    }
  });

  it('malformed ranges and undisposed findings cannot clear the limit', () => {
    const f = history();
    try {
      for (const fields of [
        { range: 'HEAD..HEAD' },
        { range: `${f.commits[3]}..${f.commits[7]}` },
        { range: `${f.baseline}..${'f'.repeat(40)}` },
        { reviewer: '' },
        { findings: [{ id: 'F1' }] },
      ]) {
        record(f, { fields });
        assert.equal(pending(f.sb).status, 1);
      }
      record(f, { fields: { findings: [{ id: 'F1' }], dispositions: [{ finding: 'F1', disposition: 'argue', note: 'Documented non-defect.' }] } });
      const result = pending(f.sb);
      assert.equal(result.status, 0, out(result));
    } finally {
      f.sb.cleanup();
    }
  });

  it('a side-branch review cannot cover main', () => {
    const f = history();
    try {
      git(f.sb, 'checkout', '-qb', 'side', f.baseline);
      f.sb.write('side.txt', 'unrelated\n');
      git(f.sb, 'add', 'side.txt');
      git(f.sb, 'commit', '-qm', 'side review target');
      const side = git(f.sb, 'rev-parse', 'HEAD');
      git(f.sb, 'checkout', '-q', 'main');
      record(f, { end: side });
      assert.equal(pending(f.sb).status, 1);
    } finally {
      f.sb.cleanup();
    }
  });

  it('changing the pending roadmap or using an archived task ID cannot evade the boundary', () => {
    const f = history();
    try {
      f.sb.write('docs/milestones/roadmap.md', roadmap('M19'));
      git(f.sb, 'add', 'docs/milestones/roadmap.md');
      assert.equal(pending(f.sb, 'M17.99: fix(harness): archived follow-up').status, 1);
    } finally {
      f.sb.cleanup();
    }
  });

  it('CI checks the exact historical tree rather than a later staged review', () => {
    const f = history(9);
    try {
      record(f);
      const eighth = f.sb.node(POLICY, ['--commit', f.commits[7]]);
      assert.equal(eighth.status, 0, out(eighth));
      const ninth = f.sb.node(POLICY, ['--commit', f.commits[8]]);
      assert.equal(ninth.status, 1, out(ninth));
      const pipeline = f.sb.node('scripts/gates/check-commits.mjs', ['--range', `${f.baseline}..${f.commits[8]}`]);
      assert.equal(pipeline.status, 1, out(pipeline));
      assert.match(out(pipeline), /checkpoint:/);
    } finally {
      f.sb.cleanup();
    }
  });

  it('the actual commit-message hook blocks the ninth task and accepts a staged covering review', () => {
    const f = history();
    try {
      f.sb.write('.githooks/commit-msg', f.sb.readRepo('.githooks/commit-msg'));
      chmodSync(f.sb.path('.githooks/commit-msg'), 0o755);
      git(f.sb, 'config', 'core.hooksPath', '.githooks');
      f.sb.write('work.txt', 'ninth task\n');
      git(f.sb, 'add', 'work.txt');
      const denied = f.sb.git('commit', '-qm', 'M18.9: test(harness): ninth task');
      assert.equal(denied.status, 1, out(denied));
      assert.match(out(denied), /checkpoint:/);
      assert.equal(git(f.sb, 'rev-parse', 'HEAD'), f.commits[7]);
      record(f);
      git(f.sb, 'commit', '-qm', 'M18.9: test(harness): ninth task with checkpoint');
      assert.notEqual(git(f.sb, 'rev-parse', 'HEAD'), f.commits[7]);
    } finally {
      f.sb.cleanup();
    }
  });

  it('a review committed with the next task satisfies both local and CI enforcement', () => {
    const f = history();
    try {
      record(f);
      assert.equal(pending(f.sb).status, 0);
      git(f.sb, 'commit', '-qm', 'M18.9: test(harness): include checkpoint evidence');
      const result = f.sb.node(POLICY, ['--commit', git(f.sb, 'rev-parse', 'HEAD')]);
      assert.equal(result.status, 0, out(result));
    } finally {
      f.sb.cleanup();
    }
  });

  it('commits predating policy adoption are not retroactively rejected', () => {
    const f = history(9, { legacy: true });
    try {
      const result = f.sb.node(POLICY, ['--commit', f.commits[8]]);
      assert.equal(result.status, 0, out(result));
    } finally {
      f.sb.cleanup();
    }
  });

  it('unstaged threshold edits cannot relax the index or historical commit boundary', () => {
    const f = history(9);
    try {
      f.sb.edit('scripts/gates/thresholds.mjs', (text) =>
        text.replace('CHECKPOINT_EVERY_TASK_COMMITS: { value: 8', 'CHECKPOINT_EVERY_TASK_COMMITS: { value: 100'),
      );
      const local = pending(f.sb);
      assert.equal(local.status, 1, out(local));
      const ci = f.sb.node(POLICY, ['--commit', f.commits[8]]);
      assert.equal(ci.status, 1, out(ci));
    } finally {
      f.sb.cleanup();
    }
  });

  it('removing a previously adopted policy from the index fails closed', () => {
    const f = history(1);
    try {
      git(f.sb, 'rm', '--cached', POLICY);
      const result = pending(f.sb);
      assert.equal(result.status, 1, out(result));
    } finally {
      f.sb.cleanup();
    }
  });

  it('refuses a feature commit and accepts a harness commit while a blocks-landing row is open, but still allows local commits (M18.123)', () => {
    const f = history(2);
    const exact = (subject, file) => {
      f.sb.write(file, `${subject}\n`);
      git(f.sb, 'add', file);
      git(f.sb, 'commit', '-qm', subject);
      const sha = git(f.sb, 'rev-parse', 'HEAD');
      git(f.sb, 'reset', '-q', '--hard', 'HEAD~1');
      return f.sb.node(POLICY, ['--commit', sha]);
    };
    try {
      const backlog = f.sb.read('docs/backlog/current.md');
      const rows = [
        '| M18.30 | CI green `blocks-landing` | HARNESS, FR-LIB-007 | acceptance | | todo | |',
        '| M18.31 | feature | FR-LIB-007 | acceptance | | todo | |',
        '| M18.32 | gate | HARNESS | acceptance | | todo | |',
      ];
      f.sb.write('docs/backlog/current.md', `${backlog}\n${rows.join('\n')}\n`);
      git(f.sb, 'commit', '-qam', 'mark the blocking row');
      const feature = exact('M18.31: feat(packs): a feature', 'feature.txt');
      assert.equal(feature.status, 1, out(feature));
      assert.match(out(feature), /M18\.31 changes feature\.txt, which is not a harness path, and M18\.30 blocks landing/);
      assert.equal(exact('M18.32: fix(harness): a gate', 'scripts/gates/gate.txt').status, 0);
      assert.equal(exact('M18.30: fix(ci): the blocking row', 'ci.txt').status, 0);
      // work continues locally: the commit-msg hook does not refuse the feature (r1 F1)
      const local = pending(f.sb, 'M18.31: feat(packs): a feature');
      assert.equal(local.status, 0, out(local));
      // a feature commit cannot clear the mark itself: closing it needs CI evidence (M18.135)
      f.sb.write('docs/backlog/current.md', f.sb.read('docs/backlog/current.md').replace('| todo | |\n| M18.31', '| done | |\n| M18.31'));
      const clear = exact('M18.31: feat(packs): a feature', 'docs/backlog/current.md');
      assert.equal(clear.status, 1, out(clear));
      assert.match(out(clear), /closes M18\.30 \(done, removed or unmarked\) without a green three-OS CI record/);
      f.sb.write('docs/backlog/current.md', f.sb.read('docs/backlog/current.md').replace('| todo | |\n| M18.31', '| done | |\n| M18.31'));
      git(f.sb, 'commit', '-qam', 'M18.30: fix(ci): the blocking row');
      const after = exact('M18.31: feat(packs): a feature', 'feature.txt');
      assert.equal(after.status, 0, out(after));
    } finally {
      f.sb.cleanup();
    }
  });

  it('a commit confined to harness paths may bring its own row while a row blocks landing; a label exempts nothing (M18.139, M18.135)', () => {
    const f = history(2);
    const exact = (subject, edit) => {
      f.sb.write('docs/backlog/current.md', edit(f.sb.read('docs/backlog/current.md')));
      git(f.sb, 'commit', '-qam', subject);
      const sha = git(f.sb, 'rev-parse', 'HEAD');
      git(f.sb, 'reset', '-q', '--hard', 'HEAD~1');
      return f.sb.node(POLICY, ['--commit', sha]);
    };
    try {
      const rows = ['| M18.30 | CI green `blocks-landing` | HARNESS | acceptance | | todo | |', '| M18.31 | feature | FR-LIB-007 | acceptance | | todo | |'];
      f.sb.write('docs/backlog/current.md', `${f.sb.read('docs/backlog/current.md')}\n${rows.join('\n')}\n`);
      git(f.sb, 'commit', '-qam', 'mark the blocking row');
      const own = exact('M18.40: fix(harness): new gate', (b) => `${b}| M18.40 | gate | HARNESS | acceptance | | done | |\n`);
      assert.equal(own.status, 0, out(own));
      // the paths decide, whatever the Req cell says (M18.135)
      const newFeature = exact('M18.41: feat(packs): new feature', (b) => `${b}| M18.41 | feature | FR-LIB-007 | acceptance | | done | |\n`);
      assert.equal(newFeature.status, 0, out(newFeature));
      // a self-labelled HARNESS row does not exempt a commit outside harness paths (r1 F1)
      f.sb.write('packages/x.ts', 'export {};\n');
      git(f.sb, 'add', 'packages/x.ts');
      const sneaky = exact('M18.42: feat(packs): sneaky', (b) => `${b}| M18.42 | sneaky | HARNESS | acceptance | | done | |\n`);
      assert.equal(sneaky.status, 1, out(sneaky));
      assert.match(out(sneaky), /M18\.42 changes packages\/x\.ts, which is not a harness path/);
    } finally {
      f.sb.cleanup();
    }
  });

  it('the planned fix of a red ci run lands while a row blocks landing; a trailer alone exempts nothing (M18.181)', () => {
    const f = history(2);
    const runsFile = f.sb.path('.harness/tmp/runs.json');
    const exact = (message, file = 'packages/cli/fix.ts', edit = (b) => b, keep = false) => {
      f.sb.write('docs/backlog/current.md', edit(f.sb.read('docs/backlog/current.md')));
      f.sb.write(file, `${message}\n`);
      git(f.sb, 'add', '-A');
      git(f.sb, 'commit', '-qm', message);
      const sha = git(f.sb, 'rev-parse', 'HEAD');
      if (!keep) git(f.sb, 'reset', '-q', '--hard', 'HEAD~1');
      return f.sb.node(POLICY, ['--commit', sha, '--ci-runs-file', runsFile]);
    };
    try {
      const rows = [
        '| M18.30 | CI green `blocks-landing` | HARNESS | acceptance | | todo | |',
        '| M18.50 | Windows fix (ci 77) | FR-LIB-004 | WHEN x THE SYSTEM SHALL y; the commit SHALL carry `Fixes-ci: 77` | | todo | |',
        '| M18.51 | feature | FR-LIB-007 | acceptance | | todo | |',
      ];
      f.sb.write('docs/backlog/current.md', `${f.sb.read('docs/backlog/current.md')}\n${rows.join('\n')}\n`);
      git(f.sb, 'commit', '-qam', 'plan the fix');
      // what GitHub reports (M18.192): ci run 77 red on this branch, with a failed job while still pending
      const onBranch = git(f.sb, 'rev-parse', 'HEAD~1');
      const ciRun = (databaseId, conclusion, jobs = [], headSha = onBranch) => ({ databaseId, workflowName: 'ci', headSha, conclusion, jobs });
      f.sb.write(
        '.harness/tmp/runs.json',
        JSON.stringify([ciRun(77, null, [{ name: 'verify (windows-latest)', conclusion: 'failure' }]), ciRun(78, 'failure'), ciRun(79, 'failure')]),
      );
      // the planned fix, with the trailer its row names, lands through the mark
      const fix = exact('M18.50: fix(cli): the Windows fix\n\nFixes-ci: 77');
      assert.equal(fix.status, 0, out(fix));
      // the same commit naming another run, or none, is refused
      for (const message of ['M18.50: fix(cli): the Windows fix\n\nFixes-ci: 78', 'M18.50: fix(cli): the Windows fix']) {
        const r = exact(message);
        assert.equal(r.status, 1, `${message}\n${out(r)}`);
        assert.match(out(r), /M18\.50 changes packages\/cli\/fix\.ts, which is not a harness path/);
      }
      // a run id that is only a prefix of the planned one exempts nothing (r1 F2)
      assert.equal(exact('M18.50: fix(cli): the Windows fix\n\nFixes-ci: 7').status, 1);
      // a done row exempts nothing: any later commit could reuse its id and trailer (r1 F1)
      const doneRow = '| M18.53 | old fix (ci 79) | FR-LIB-004 | the commit SHALL carry `Fixes-ci: 79` | | done | abc1234 |';
      f.sb.write('docs/backlog/current.md', `${f.sb.read('docs/backlog/current.md')}${doneRow}\n`);
      git(f.sb, 'commit', '-qam', 'an old fix, done');
      const reused = exact('M18.53: feat(packs): reuses an old fix id\n\nFixes-ci: 79');
      assert.equal(reused.status, 1, out(reused));
      // a feature commit carrying the trailer is refused: its row does not name the run
      const feature = exact('M18.51: feat(packs): a feature\n\nFixes-ci: 77');
      assert.equal(feature.status, 1, out(feature));
      // nor can a commit bring the row that would exempt it: the row must be on the tip it lands on
      const brought = exact(
        'M18.52: fix(cli): self-planned\n\nFixes-ci: 77',
        'packages/cli/x.ts',
        (b) => `${b}| M18.52 | fix | FR-LIB-004 | the commit SHALL carry \`Fixes-ci: 77\` | | done | |\n`,
      );
      assert.equal(brought.status, 1, out(brought));
    } finally {
      f.sb.cleanup();
    }
  });

  it('HARNESS: only a title ending with the mark blocks landing; a mention mid-title does not (M18.197, cp25 F3)', async () => {
    const { blockingRows, landingBlock } = await import('../../scripts/gates/landing-block.mjs');
    const backlog = [
      '| M18.30 | CI green `blocks-landing` | HARNESS | acceptance | | todo | |',
      '| M18.31 | A planned ci fix lands through `blocks-landing` once (cp24 F3) | HARNESS | acceptance | | todo | |',
      '| M18.32 | `blocks-landing` is a mark only as the last token | HARNESS | acceptance | | todo | |',
      '| M18.33 | feature | FR-LIB-007 | acceptance | | todo | |',
    ].join('\n');
    assert.deepEqual(
      blockingRows(backlog).map((r) => r.id),
      ['M18.30'],
    );
    // the trailing mark still blocks a product commit of another row; a mention-only row's own product commit is no exemption
    assert.match(landingBlock({ backlog, proposed: backlog, subject: 'M18.33: feat(x): y', paths: ['packages/core/x.ts'] }) ?? '', /M18\.30 blocks landing/);
    assert.match(landingBlock({ backlog, proposed: backlog, subject: 'M18.31: feat(x): y', paths: ['packages/core/x.ts'] }) ?? '', /M18\.30 blocks landing/);
    // closing a mention-only row needs no ci evidence: it never was a mark
    const done = backlog.replace(
      '| M18.31 | A planned ci fix lands through `blocks-landing` once (cp24 F3) | HARNESS | acceptance | | todo | |',
      '| M18.31 | A planned ci fix lands through `blocks-landing` once (cp24 F3) | HARNESS | acceptance | | done | |',
    );
    assert.equal(landingBlock({ backlog, subject: 'M18.31: fix(harness): y', proposed: done, paths: ['scripts/gates/x.mjs'] }), null);
  });

  it('HARNESS: a planned ci fix lands once, and only for a real red run of the branch (M18.192, cp24 F3)', () => {
    const f = history(2);
    const runsFile = f.sb.path('.harness/tmp/runs.json');
    const exact = (message, keep = false) => {
      f.sb.write('packages/cli/fix.ts', `${message}\n`);
      git(f.sb, 'add', '-A');
      git(f.sb, 'commit', '-qm', message);
      const sha = git(f.sb, 'rev-parse', 'HEAD');
      if (!keep) git(f.sb, 'reset', '-q', '--hard', 'HEAD~1');
      return f.sb.node(POLICY, ['--commit', sha, '--ci-runs-file', runsFile]);
    };
    try {
      const row = (id, run) => `| ${id} | fix (ci ${run}) | FR-LIB-004 | the commit SHALL carry \`Fixes-ci: ${run}\` | | todo | |`;
      const rows = [
        '| M18.30 | CI green `blocks-landing` | HARNESS | acceptance | | todo | |',
        row('M18.60', 90),
        row('M18.61', 91),
        row('M18.62', 92),
        row('M18.63', 93),
      ];
      f.sb.write('docs/backlog/current.md', `${f.sb.read('docs/backlog/current.md')}\n${rows.join('\n')}\n`);
      git(f.sb, 'commit', '-qam', 'plan the fixes');
      const onBranch = git(f.sb, 'rev-parse', 'HEAD~1');
      const ciRun = (databaseId, conclusion, headSha = onBranch, workflowName = 'ci') => ({ databaseId, workflowName, headSha, conclusion, jobs: [] });
      // 90 is made up (GitHub has no such run), 91 is green, 92 ran off the branch, 93 is red on it
      f.sb.write('.harness/tmp/runs.json', JSON.stringify([ciRun(91, 'success'), ciRun(92, 'failure', 'f'.repeat(40)), ciRun(93, 'failure')]));
      const refused = (message, pattern) => {
        const r = exact(message);
        assert.equal(r.status, 1, `${message}\n${out(r)}`);
        assert.match(out(r), pattern);
      };
      refused('M18.60: fix(cli): made-up run\n\nFixes-ci: 90', /M18\.60: its Fixes-ci exempts nothing: ci-run-red: run 90 was not found/);
      refused('M18.61: fix(cli): green run\n\nFixes-ci: 91', /run 91 is not red \(conclusion success, no failed job\)/);
      refused('M18.62: fix(cli): another branch\n\nFixes-ci: 92', /run 92 ran on fffffff, which is not on the branch/);
      // the planned first fix of a real red run passes, and lands
      const first = exact('M18.63: fix(cli): the fix\n\nFixes-ci: 93', true);
      assert.equal(first.status, 0, out(first));
      // a second commit of the task carrying the same trailer is refused: the exemption is spent
      refused('M18.63: fix(cli): again\n\nFixes-ci: 93', /a M18\.63 commit carrying Fixes-ci: 93 already landed; the exemption is spent/);
    } finally {
      f.sb.cleanup();
    }
  });

  it('while a row blocks landing, harness paths are one positive list and closing the row needs CI evidence for its parent (M18.135)', () => {
    const f = history(2);
    const BACKLOG = 'docs/backlog/current.md';
    /** Commit `files` with `subject`, judge the exact commit, and keep it only when `keep`. */
    const exact = (subject, files, keep = false) => {
      for (const [path, text] of Object.entries(files)) {
        f.sb.write(path, typeof text === 'function' ? text(f.sb.read(path)) : text);
        git(f.sb, 'add', path);
      }
      git(f.sb, 'commit', '-qm', subject);
      const sha = git(f.sb, 'rev-parse', 'HEAD');
      const r = f.sb.node(POLICY, ['--commit', sha, '--ci-runs-file', f.sb.path('.harness/tmp/runs.json')]);
      if (!keep) git(f.sb, 'reset', '-q', '--hard', 'HEAD~1');
      return r;
    };
    try {
      f.sb.write(BACKLOG, `${f.sb.read(BACKLOG)}\n| M18.30 | CI green \`blocks-landing\` | HARNESS | acceptance | | todo | |\n`);
      git(f.sb, 'commit', '-qam', 'mark the blocking row');
      // a row added as HARNESS by an earlier harness-path commit does not let a later commit touching packages/ land
      const added = exact('M18.50: chore(harness): add a row', { [BACKLOG]: (b) => `${b}| M18.50 | gate | HARNESS | acceptance | | todo | |\n` }, true);
      assert.equal(added.status, 0, out(added));
      const later = exact('M18.50: feat(harness): the row', { 'packages/core/src/x.ts': 'export {};\n' });
      assert.equal(later.status, 1, out(later));
      assert.match(out(later), /M18\.50 changes packages\/core\/src\/x\.ts, which is not a harness path/);
      // product and contract sources under scripts/ and docs/ are not harness paths
      for (const path of ['scripts/fonts/subset.mjs', 'docs/requirements/10-functional.md']) {
        const r = exact('M18.50: fix(harness): the row', { [path]: 'x\n' });
        assert.equal(r.status, 1, `${path}: ${out(r)}`);
        assert.match(out(r), /which is not a harness path/);
      }
      for (const path of ['scripts/gates/g.mjs', 'scripts/ci/c.mjs', 'scripts/tooling/t.mjs', 'docs/harness/h.md', 'docs/milestones/m.md', '.github/x.yml'])
        assert.equal(exact('M18.50: fix(harness): the row', { [path]: 'x\n' }).status, 0, path);
      // closing the blocking row, by any commit, needs a record at or after its parent
      const parent = git(f.sb, 'rev-parse', 'HEAD');
      const older = git(f.sb, 'rev-parse', 'HEAD~1');
      const record = (sha) => `${JSON.stringify({ sha, runs: { gates: 1, ci: 2 } })}\n`;
      // what GitHub reports for runs 1 (gates) and 2 (ci) of `sha`
      const runs = (sha) => {
        const job = (name) => ({ name, conclusion: 'success' });
        const ci = ['verify (ubuntu-latest)', 'verify (windows-latest)', 'verify (macos-latest)', 'visual', 'lighthouse'].map(job);
        f.sb.write(
          '.harness/tmp/runs.json',
          JSON.stringify([
            { databaseId: 1, workflowName: 'gates', headSha: sha, conclusion: 'success', jobs: [job('gates')] },
            { databaseId: 2, workflowName: 'ci', headSha: sha, conclusion: 'success', jobs: ci },
          ]),
        );
      };
      runs(parent);
      const done = (b) => b.replace('blocks-landing` | HARNESS | acceptance | | todo |', 'blocks-landing` | HARNESS | acceptance | | done |');
      for (const [why, files] of [
        ['no record', { [BACKLOG]: done }],
        ['a record before the parent', { [BACKLOG]: done, '.harness/reviews/ci-evidence.json': record(older) }],
        ['a record without both workflows', { [BACKLOG]: done, '.harness/reviews/ci-evidence.json': `${JSON.stringify({ sha: parent, runs: { ci: 2 } })}\n` }],
        ['an unmarked row', { [BACKLOG]: (b) => b.replace(' `blocks-landing`', '') }],
      ]) {
        const r = exact('M18.30: fix(ci): close', files);
        assert.equal(r.status, 1, `${why}: ${out(r)}`);
        assert.match(out(r), /M18\.30: it closes M18\.30 \(done, removed or unmarked\) without a green three-OS CI record for its parent or later/);
      }
      // a hand-written record whose runs GitHub does not hold as green on that sha is not evidence (r1 F2)
      runs(older);
      const forged = exact('M18.30: fix(ci): close', { [BACKLOG]: done, '.harness/reviews/ci-evidence.json': record(parent) });
      assert.equal(forged.status, 1, out(forged));
      assert.match(out(forged), /ran [0-9a-f]{7}, not [0-9a-f]{7}/);
      runs(parent);
      // a commit that is not a task commit (a Revert, a fixup) is judged too (r1 F1)
      for (const [why, files] of [
        ['a revert closing the row', { [BACKLOG]: done }],
        ['a revert touching packages/', { 'packages/core/src/x.ts': 'export {};\n' }],
      ]) {
        const r = exact('Revert "M18.30: mark the blocking row"', files);
        assert.equal(r.status, 1, `${why}: ${out(r)}`);
        assert.match(out(r), /"Revert "M18\.30: mark the blocking row""(: it closes| changes packages)/);
      }
      assert.equal(exact('fixup! M18.50: gate', { 'scripts/gates/g.mjs': 'y\n' }).status, 0, 'a harness-path fixup lands');
      const closed = exact('M18.30: fix(ci): close', { [BACKLOG]: done, '.harness/reviews/ci-evidence.json': record(parent) });
      assert.equal(closed.status, 0, out(closed));
    } finally {
      f.sb.cleanup();
    }
  });
});
