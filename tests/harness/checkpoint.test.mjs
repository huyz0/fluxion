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
      assert.match(out(feature), /M18\.31 is not a harness row and M18\.30 blocks landing/);
      assert.equal(exact('M18.32: fix(harness): a gate', 'gate.txt').status, 0);
      assert.equal(exact('M18.30: fix(ci): the blocking row', 'ci.txt').status, 0);
      // work continues locally: the commit-msg hook does not refuse the feature (r1 F1)
      const local = pending(f.sb, 'M18.31: feat(packs): a feature');
      assert.equal(local.status, 0, out(local));
      // a feature commit cannot clear the mark itself: the parent backlog decides
      f.sb.write('docs/backlog/current.md', f.sb.read('docs/backlog/current.md').replace('| todo | |\n| M18.31', '| done | |\n| M18.31'));
      assert.equal(exact('M18.31: feat(packs): a feature', 'docs/backlog/current.md').status, 1);
      f.sb.write('docs/backlog/current.md', f.sb.read('docs/backlog/current.md').replace('| todo | |\n| M18.31', '| done | |\n| M18.31'));
      git(f.sb, 'commit', '-qam', 'M18.30: fix(ci): the blocking row');
      const after = exact('M18.31: feat(packs): a feature', 'feature.txt');
      assert.equal(after.status, 0, out(after));
    } finally {
      f.sb.cleanup();
    }
  });
});
