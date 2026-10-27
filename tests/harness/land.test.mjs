// HARNESS NFR-DX-003: rebased task commits land only through the gates, bound to their reviewed content (M18.106, ADR-0195).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, rmSync, writeFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { fillCommitCells } from '../../scripts/harness/land.mjs';
import { cleanEnv, out, sandbox } from './helpers.mjs';

describe('fillCommitCells (M18.106)', () => {
  const ROW = (id, state, commit) => `| ${id} | task | HARNESS | WHEN x THE SYSTEM SHALL y | — | ${state} | ${commit} |`;
  it('fills done rows with their commit and follows rewritten commits, leaving other cells alone', () => {
    const text = [
      ROW('M1.1', 'done', ''),
      ROW('M1.2', 'done', 'aaaaaaa'),
      ROW('M1.3', 'todo', ''),
      ROW('M1.4', 'done', 'ccccccc'),
      ROW('M1.5', 'done', ''),
      ROW('M1.6', 'done', 'dddddddd'),
    ].join('\n');
    const filled = fillCommitCells(
      text,
      new Map([
        ['M1.1', '1111111'],
        ['M1.3', '3333333'],
      ]),
      // full old sha → full new sha; cells keep their abbreviation length (M18.106 r1 F3)
      new Map([
        [`aaaaaaa${'0'.repeat(33)}`, `bbbbbbb${'1'.repeat(33)}`],
        [`dddddddd${'0'.repeat(32)}`, `eeeeeeee${'1'.repeat(32)}`],
      ]),
    );
    assert.deepEqual(filled.split('\n'), [
      ROW('M1.1', 'done', '1111111'),
      ROW('M1.2', 'done', 'bbbbbbb'),
      ROW('M1.3', 'todo', ''),
      ROW('M1.4', 'done', 'ccccccc'),
      ROW('M1.5', 'done', ''),
      ROW('M1.6', 'done', 'eeeeeeee'),
    ]);
  });
});

describe('land (M18.106)', () => {
  let sb;
  let origin;
  let other;
  const ok = (r) => {
    assert.equal(r.status, 0, out(r));
    return r.stdout.trim();
  };
  const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', env: cleanEnv() });
  const remoteHead = () => ok(git(origin, 'rev-parse', 'main'));
  const head = () => ok(sb.git('rev-parse', 'HEAD'));
  const land = (...args) => sb.node('scripts/harness/land.mjs', args);
  /** Another stream pushes `file` straight to the remote. */
  function upstream(file, text) {
    ok(git(other, 'pull', '-q', '--ff-only', 'origin', 'main'));
    spawnSync('sh', ['-c', `mkdir -p "$(dirname '${file}')" && printf '%s' '${text}' > '${file}'`], { cwd: other });
    ok(git(other, 'add', file));
    ok(git(other, 'commit', '-q', '--no-verify', '-m', `chore: upstream ${file}`));
    ok(git(other, 'push', '-q', 'origin', 'HEAD:main'));
  }
  /** A reviewed task commit made through the real hooks. */
  function reviewed(task, file, text) {
    sb.write(file, text);
    ok(sb.git('add', file));
    const hash = ok(sb.node('scripts/harness/review.mjs', ['hash']));
    sb.write('.harness/tmp/v.json', JSON.stringify({ task, kind: 'code', diff_sha256: hash, reviewer: 'test:unit', verdict: 'pass', findings: [] }));
    ok(sb.node('scripts/harness/review.mjs', ['record', '--file', sb.path('.harness/tmp/v.json'), '--task', task]));
    ok(sb.git('add', '.harness/reviews/digest.log'));
    ok(sb.git('commit', '-q', '-m', `${task}: test: ${file}`));
    return head();
  }
  function reset() {
    ok(sb.git('fetch', '-q', 'origin', 'main'));
    ok(sb.git('reset', '-q', '--hard', 'FETCH_HEAD'));
  }

  before(() => {
    sb = sandbox(undefined, { git: true });
    sb.write('src/shared.txt', 'one\ntwo\nthree\n');
    ok(sb.git('add', '-A'));
    ok(sb.git('commit', '-q', '--no-verify', '-m', 'fixture: shared file'));
    origin = `${sb.dir}-origin.git`;
    other = `${sb.dir}-other`;
    ok(git(sb.dir, 'clone', '-q', '--bare', sb.dir, origin));
    ok(sb.git('remote', 'add', 'origin', origin));
    ok(git(sb.dir, 'clone', '-q', origin, other));
    for (const [k, v] of [
      ['user.email', 'other@example.invalid'],
      ['user.name', 'other-stream'],
    ])
      ok(git(other, 'config', k, v));
    for (const hook of ['pre-commit', 'commit-msg']) {
      sb.write(`.githooks/${hook}`, sb.readRepo(`.githooks/${hook}`));
      chmodSync(sb.path(`.githooks/${hook}`), 0o755); // POSIX git skips non-executable hooks
    }
    ok(sb.git('config', 'core.hooksPath', '.githooks'));
  });
  after(() => {
    sb.cleanup();
    for (const dir of [origin, other]) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it('re-gates a reviewed commit on the moved remote branch and pushes it', () => {
    reviewed('M0.5', 'src/mine.txt', 'mine\n');
    upstream('src/theirs.txt', 'theirs');
    const r = land('--push');
    assert.equal(r.status, 0, out(r));
    assert.match(r.stdout, /landed 1 commit\(s\) on origin\/main/);
    assert.equal(remoteHead(), head());
    assert.equal(ok(sb.git('log', '-1', '--format=%s')), 'M0.5: test: src/mine.txt');
    assert.equal(ok(sb.git('show', 'HEAD~1:src/theirs.txt')), 'theirs');
  });

  it('without --push only re-gates, and reports nothing to land once the remote has it', () => {
    reviewed('M0.6', 'src/second.txt', 'second\n');
    upstream('src/third.txt', 'third');
    const before = remoteHead();
    const r = land();
    assert.equal(r.status, 0, out(r));
    assert.match(r.stdout, /re-gated 1 commit\(s\).*not pushed/);
    assert.equal(remoteHead(), before);
    ok(sb.git('push', '-q', 'origin', 'HEAD:main'));
    assert.match(land().stdout, /nothing to land/);
  });

  it('refuses an unreviewed commit, leaving the branch where it started and the remote untouched', () => {
    sb.write('src/unreviewed.txt', 'x\n');
    ok(sb.git('add', 'src/unreviewed.txt'));
    ok(sb.git('commit', '-q', '--no-verify', '-m', 'M0.7: test: unreviewed'));
    upstream('src/fourth.txt', 'fourth');
    const start = head();
    const before = remoteHead();
    const r = land('--push');
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /gates refused [0-9a-f]{7} \(M0\.7: test: unreviewed\)/);
    assert.equal(head(), start);
    assert.equal(remoteHead(), before);
    reset();
  });

  it('refuses a commit whose re-applied diff no longer matches the review', () => {
    upstream('src/letters.txt', 'a\nb\nc\nd\ne\nf\ng\n');
    reset();
    // upstream edits the hunk's context without touching the change: it re-applies cleanly, but
    // the re-applied diff is not the reviewed one (M18.106 r1 F2)
    reviewed('M0.8', 'src/letters.txt', 'a\nb\nc\nd\nE\nf\ng\n');
    upstream('src/letters.txt', 'a\nB\nc\nd\ne\nf\ng\n');
    const start = head();
    const r = land('--push');
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /gates refused [0-9a-f]{7} \(M0\.8: test: src\/letters\.txt\)/);
    assert.match(r.stderr, /no pass verdict for staged content/);
    assert.equal(head(), start);
    reset();
  });

  it('stops on a conflict and restores the branch', () => {
    reviewed('M0.9', 'src/shared.txt', 'ONE\ntwo\nmine\n');
    upstream('src/shared.txt', 'ONE\ntwo\ntheirs\n');
    const start = head();
    const r = land('--push');
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /conflicts with the remote branch/);
    assert.equal(head(), start);
    assert.equal(ok(sb.git('status', '--porcelain', '--untracked-files=no')), '');
  });

  it('refuses to land when git would not run the repo hooks (M18.106 r1 F1)', () => {
    reset();
    sb.write('src/nohooks.txt', 'x\n');
    ok(sb.git('add', 'src/nohooks.txt'));
    ok(sb.git('commit', '-q', '--no-verify', '-m', 'M0.10: test: unreviewed'));
    const before = remoteHead();
    ok(sb.git('config', '--unset', 'core.hooksPath'));
    const r = land('--push');
    ok(sb.git('config', 'core.hooksPath', '.githooks'));
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /git does not run the repo hooks/);
    assert.equal(remoteHead(), before);
    reset();
  });

  it('refuses before a reset would overwrite an untracked file (M18.106 r1 F4)', () => {
    reviewed('M0.11', 'src/eleven.txt', 'eleven\n');
    upstream('src/clash.txt', 'theirs');
    sb.write('src/clash.txt', 'my unsaved work\n');
    const start = head();
    const r = land('--push');
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /untracked files would be overwritten[\s\S]*src\/clash\.txt/);
    assert.equal(sb.read('src/clash.txt'), 'my unsaved work\n');
    assert.equal(head(), start);
    rmSync(sb.path('src/clash.txt'));
  });

  it('reports a final remote refusal at once instead of retrying (M18.106 r1 F5)', () => {
    const hook = `${origin}/hooks/pre-receive`;
    writeFileSync(hook, '#!/bin/sh\necho protected >&2\nexit 1\n');
    chmodSync(hook, 0o755);
    const start = head();
    const r = land('--push');
    rmSync(hook);
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /push failed:[\s\S]*remote rejected/);
    assert.doesNotMatch(r.stderr, /kept moving/);
    assert.equal(head(), start);
  });

  it('retries while the remote keeps moving, then gives up with the branch restored (M18.106 r2 F1)', () => {
    reviewed('M0.12', 'src/twelve.txt', 'twelve\n');
    // the first attempt checks out a file upstream added; the retry must not take it for untracked work
    upstream('src/added-upstream.txt', 'added');
    // pushes go to a mirror one commit ahead of what land fetches, so every push is non-fast-forward
    const mirror = `${sb.dir}-mirror.git`;
    ok(git(sb.dir, 'clone', '-q', '--bare', origin, mirror));
    ok(git(other, 'commit', '-q', '--no-verify', '--allow-empty', '-m', 'chore: mirror ahead'));
    ok(git(other, 'push', '-q', mirror, 'HEAD:main'));
    ok(git(other, 'reset', '-q', '--hard', 'HEAD~1'));
    ok(sb.git('config', 'remote.origin.pushurl', mirror));
    try {
      const start = head();
      const r = land('--push', '--attempts', '2');
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, /kept moving; 2 attempts used/);
      assert.equal(head(), start);
    } finally {
      ok(sb.git('config', '--unset', 'remote.origin.pushurl'));
      rmSync(mirror, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it('refuses a feature commit and lands a harness commit while a blocks-landing row is open (M18.123)', () => {
    reset();
    // the feature commit was reviewed before another stream marked the blocking row
    reviewed('M0.14', 'src/feature.txt', 'feature\n');
    const rows = [
      '| M0.13 | CI green `blocks-landing` | HARNESS | acceptance | | todo | |',
      '| M0.14 | feature | FR-LIB-007 | acceptance | | todo | |',
      '| M0.15 | gate | HARNESS | acceptance | | todo | |',
    ];
    upstream('docs/backlog/current.md', `${rows.join('\n')}\n`);
    const start = head();
    const before = remoteHead();
    const refused = land('--push');
    assert.equal(refused.status, 1, out(refused));
    assert.match(refused.stderr, /\(M0\.14: test: src\/feature\.txt\) may not land: M0\.14 is not a harness row and M0\.13 blocks landing/);
    assert.equal(head(), start);
    assert.equal(remoteHead(), before);
    reset();
    reviewed('M0.15', 'src/gate.txt', 'gate\n');
    const landed = land('--push');
    assert.equal(landed.status, 0, out(landed));
    assert.equal(remoteHead(), head());
    // a harness commit that adds its own row lands too (M18.139)
    const backlog = `${sb.read('docs/backlog/current.md')}| M0.16 | new gate | HARNESS | acceptance | | done | |\n`;
    reviewed('M0.16', 'docs/backlog/current.md', backlog);
    const own = land('--push');
    assert.equal(own.status, 0, out(own));
    assert.equal(remoteHead(), head());
  });
});
