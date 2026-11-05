// HARNESS NFR-DX-003: rebased task commits land only through the gates, bound to their reviewed content (M18.106, ADR-0195).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { ciRefusal, fillCommitCells, regenerateSteps } from '../../scripts/harness/land.mjs';
import { cleanEnv, out, sandbox } from './helpers.mjs';

const STATE = '.harness/state.json';

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

describe('regenerateSteps (M18.163)', () => {
  it('HARNESS: rebuilds project-reference declarations (tsc -b) before the build and the API reports read them (M18.163)', () => {
    // run in the repository, where turbo.json and the traceability file exist
    const steps = regenerateSteps().map(([needed, cmd, args]) => ({ needed, command: [cmd === process.execPath ? 'node' : cmd, ...args].join(' ') }));
    assert.ok(
      steps.every((s) => s.needed),
      JSON.stringify(steps),
    );
    assert.deepEqual(
      steps.map((s) => s.command),
      ['pnpm run typecheck', 'pnpm run build', 'node scripts/gates/check-api.mjs --update', 'node scripts/gates/check-trace.mjs --write'],
    );
  });
});

describe('ciRefusal (M18.223, cp32 F2)', () => {
  const product = { paths: ['packages/core/src/x.ts', '.harness/progress.md'], subject: 'M1.2: fix(core): x', message: 'M1.2: fix(core): x\n' };
  const feature = { ...product, subject: 'M1.2: feat(core): x' };
  const harness = { paths: ['scripts/gates/x.mjs', 'docs/backlog/current.md'], subject: 'M1.3: feat(harness): x', message: '' };
  // run 7 is red now: a completed red, or a pending run whose job already failed
  const red = [{ run: '7', workflow: 'ci', sha: 'abc1234', jobs: ['verify (windows-latest)', 'e2e (webkit)'] }];
  const fixes = (id) => ({ ...product, message: `M1.2: fix(core): x\n\nFixes-ci: ${id}\n` });
  it('HARNESS: on green every commit lands', () => {
    assert.equal(ciRefusal({ verdict: 0, red: [] }, feature), null);
  });
  it('HARNESS: on red (1) or a pending declared fix (2) a product commit needs Fixes-ci naming a run red now; a harness-only commit lands', () => {
    for (const verdict of [1, 2]) {
      const ci = { verdict, red };
      // the refusal names the red run and its failed jobs
      assert.match(
        ciRefusal(ci, product),
        new RegExp(`main's ci is red \\(last-ci exit ${verdict}\\) at run 7 \\(ci at abc1234: verify \\(windows-latest\\), e2e \\(webkit\\)\\)`),
      );
      assert.equal(ciRefusal(ci, fixes(7)), null);
      // a stale red run, red once but not now, is refused
      assert.match(ciRefusal(ci, fixes(5)), /its Fixes-ci: 5 names no run that is red now; main's ci is red .* at run 7 /);
      assert.equal(ciRefusal(ci, harness), null);
    }
    // a red verdict last-ci names no run for: nothing a Fixes-ci can name
    assert.match(ciRefusal({ verdict: 1, red: [] }, fixes(7)), /Fixes-ci: 7 names no run that is red now; .* at no run last-ci names/);
  });
  it('HARNESS: on unknown (3) a feature commit waits, with or without a scope; a fix and a harness-only feature land', () => {
    for (const subject of ['M1.2: feat(core): x', 'M1.2: feat: x', 'M1.2: feat!: x', 'M1.2: feat(core)!: x'])
      assert.match(ciRefusal({ verdict: 3, red: [] }, { ...product, subject }), /main's ci is unknown \(last-ci exit 3\)/, subject);
    assert.equal(ciRefusal({ verdict: 3, red: [] }, product), null);
    assert.equal(ciRefusal({ verdict: 3, red: [] }, { ...product, subject: 'M1.2: feature-flag(core): x' }), null);
    assert.equal(ciRefusal({ verdict: 3, red: [] }, harness), null);
  });
});

/** Key of `reviewed`'s extra files that is a commit-message trailer instead (Object.entries skips it). */
const TRAILER = Symbol('trailer');

/** A sandbox repo with the real hooks, its bare origin and another stream's clone, and the helpers that drive them; each
 * rig has its own checkpoint budget (M18.265). */
function landRig() {
  const sb = sandbox(undefined, { git: true });
  const origin = `${sb.dir}-origin.git`;
  const other = `${sb.dir}-other`;
  const ok = (r) => {
    assert.equal(r.status, 0, out(r));
    return r.stdout.trim();
  };
  const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', env: cleanEnv() });
  const remoteHead = () => ok(git(origin, 'rev-parse', 'main'));
  const head = () => ok(sb.git('rev-parse', 'HEAD'));
  /** Main's ci as last-ci reads it: no runs yet (green) unless a case passes its own --ci-runs-file (M18.223). */
  const land = (...args) => {
    if (!args.includes('--ci-runs-file')) writeFileSync(`${sb.dir}-no-runs.json`, '[]');
    return sb.node('scripts/harness/land.mjs', args.includes('--ci-runs-file') ? args : [...args, '--ci-runs-file', `${sb.dir}-no-runs.json`]);
  };
  /** Another stream pushes `file` straight to the remote. */
  function upstream(file, text) {
    ok(git(other, 'pull', '-q', '--ff-only', 'origin', 'main'));
    spawnSync('sh', ['-c', `mkdir -p "$(dirname '${file}')" && printf '%s' '${text}' > '${file}'`], { cwd: other });
    ok(git(other, 'add', file));
    ok(git(other, 'commit', '-q', '--no-verify', '-m', `chore: upstream ${file}`));
    ok(git(other, 'push', '-q', 'origin', 'HEAD:main'));
  }
  /** A reviewed task commit made through the real hooks; `extra[TRAILER]` adds a message trailer. */
  function reviewed(task, file, text, extra = {}) {
    const trailer = extra[TRAILER];
    for (const [path, body] of [[file, text], ...Object.entries(extra)]) {
      sb.write(path, body);
      ok(sb.git('add', path));
    }
    // a commit that moves a row's State moves state.json's clock, as the harness loop does (M18.266)
    if (Object.keys(extra).includes('docs/backlog/current.md') && existsSync(sb.path(STATE))) {
      const state = JSON.parse(sb.read(STATE));
      sb.write(STATE, `${JSON.stringify({ ...state, updated: new Date(Date.parse(state.updated) + 1000).toISOString() }, null, 2)}\n`);
      ok(sb.git('add', STATE));
    }
    const hash = ok(sb.node('scripts/harness/review.mjs', ['hash']));
    sb.write('.harness/tmp/v.json', JSON.stringify({ task, kind: 'code', diff_sha256: hash, reviewer: 'test:unit', verdict: 'pass', findings: [] }));
    ok(sb.node('scripts/harness/review.mjs', ['record', '--file', sb.path('.harness/tmp/v.json'), '--task', task]));
    ok(sb.git('add', '.harness/reviews/digest.log'));
    ok(sb.git('commit', '-q', '-m', `${task}: test: ${file}`, ...(trailer ? ['-m', trailer] : [])));
    return head();
  }
  function reset() {
    ok(sb.git('fetch', '-q', 'origin', 'main'));
    ok(sb.git('reset', '-q', '--hard', 'FETCH_HEAD'));
  }
  sb.write('src/shared.txt', 'one\ntwo\nthree\n');
  ok(sb.git('add', '-A'));
  ok(sb.git('commit', '-q', '--no-verify', '-m', 'fixture: shared file'));
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
  const cleanup = () => {
    sb.cleanup();
    for (const dir of [origin, other]) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  };
  return { sb, origin, other, ok, git, remoteHead, head, land, upstream, reviewed, reset, cleanup };
}

describe('land (M18.106)', () => {
  let sb, origin, other, ok, git, remoteHead, head, land, upstream, reviewed, reset, cleanup;
  before(() => {
    ({ sb, origin, other, ok, git, remoteHead, head, land, upstream, reviewed, reset, cleanup } = landRig());
  });
  after(() => cleanup());

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

  it('names the clock fix when a re-applied commit conflicts on state.json (M18.266, cp43 F1)', () => {
    const BACKLOG = 'docs/backlog/current.md';
    const row = (id, state) => `| ${id} | gate ${id} | HARNESS | acceptance | | ${state} | |`;
    upstream(BACKLOG, `${row('M0.60', 'todo')}\n`);
    reset();
    // this commit closes its row and moves the clock (reviewed() ticks it); another stream moves the clock meanwhile
    reviewed('M0.60', 'scripts/gates/M0.60.txt', 'M0.60\n', { [BACKLOG]: `${row('M0.60', 'done')}\n` });
    ok(git(other, 'pull', '-q', '--ff-only', 'origin', 'main'));
    const theirs = JSON.parse(readFileSync(join(other, STATE), 'utf8'));
    writeFileSync(join(other, STATE), `${JSON.stringify({ ...theirs, updated: new Date(Date.parse(theirs.updated) + 60_000).toISOString() }, null, 2)}\n`);
    ok(git(other, 'commit', '-q', '--no-verify', '-am', 'chore: upstream clock'));
    ok(git(other, 'push', '-q', 'origin', 'HEAD:main'));
    const start = head();
    const r = land('--push');
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /conflicts with the remote branch/);
    assert.match(r.stderr, /\.harness\/state\.json: keep the remote's fields, .* set `updated` to the time of the resolution/);
    assert.equal(head(), start);
    reset();
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

  it('lands a stack whose commits fill the Commit cells of neighbouring rows (M18.153)', () => {
    reset();
    // three more task commits would leave the later tests past the sandbox's checkpoint limit
    const restore = remoteHead();
    try {
      landsNeighbouringCells();
    } finally {
      ok(git(origin, 'update-ref', 'refs/heads/main', restore));
      ok(git(other, 'reset', '-q', '--hard', restore));
      reset();
    }
  });
  function landsNeighbouringCells() {
    const BACKLOG = 'docs/backlog/current.md';
    const row = (id, state, cell = '') => `| ${id} | gate ${id} | HARNESS | acceptance | | ${state} | ${cell} |`;
    upstream(BACKLOG, `${[row('M0.40', 'todo'), row('M0.41', 'todo'), row('M0.42', 'todo')].join('\n')}\n`);
    reset();
    // each commit marks its own row done and fills the previous row's cell, as the harness loop does;
    // the cells sit on neighbouring lines, so a cell renamed on the remote side is in the next diff's context
    const a = reviewed('M0.40', 'scripts/gates/M0.40.txt', 'M0.40\n', {
      [BACKLOG]: `${[row('M0.40', 'done'), row('M0.41', 'todo'), row('M0.42', 'todo')].join('\n')}\n`,
    });
    const b = reviewed('M0.41', 'scripts/gates/M0.41.txt', 'M0.41\n', {
      [BACKLOG]: `${[row('M0.40', 'done', a.slice(0, 7)), row('M0.41', 'done'), row('M0.42', 'todo')].join('\n')}\n`,
    });
    reviewed('M0.42', 'scripts/gates/M0.42.txt', 'M0.42\n', {
      [BACKLOG]: `${[row('M0.40', 'done', a.slice(0, 7)), row('M0.41', 'done', b.slice(0, 7)), row('M0.42', 'done')].join('\n')}\n`,
    });
    upstream('src/unrelated.txt', 'unrelated');
    const r = land('--push');
    assert.equal(r.status, 0, out(r));
    assert.match(r.stdout, /landed 3 commit\(s\)/);
    assert.equal(remoteHead(), head());
    // the landed cells name the landed commits, not the local ones
    const landed = (n) => ok(sb.git('rev-parse', '--short=7', `HEAD~${n}`));
    assert.equal(sb.read(BACKLOG), `${[row('M0.40', 'done', landed(2)), row('M0.41', 'done', landed(1)), row('M0.42', 'done')].join('\n')}\n`);
  }

  it('lands a stack whose budget record names its first commit, renamed to the landed one (M18.155)', () => {
    reset();
    const restore = remoteHead();
    try {
      const BUDGET = '.harness/budget.json';
      const record = (commit) => `${JSON.stringify({ recordedAt: '2026-10-28T00:00:00.000Z', commit, quickMs: 1 }, null, 2)}\n`;
      upstream('docs/backlog/current.md', '| M0.43 | gate | HARNESS | acceptance | | todo | |\n| M0.44 | gate | HARNESS | acceptance | | todo | |\n');
      reset();
      const first = reviewed('M0.43', 'scripts/gates/M0.43.txt', 'M0.43\n');
      // as check-budget --record does: the record names HEAD, the stack's first commit
      reviewed('M0.44', 'scripts/gates/M0.44.txt', 'M0.44\n', { [BUDGET]: record(first) });
      upstream('src/unrelated-155.txt', 'unrelated');
      const r = land('--push');
      assert.equal(r.status, 0, out(r));
      assert.equal(remoteHead(), head());
      const landedFirst = ok(sb.git('rev-parse', 'HEAD~1'));
      assert.notEqual(landedFirst, first, 'the first commit was rewritten onto the moved remote');
      assert.equal(sb.read(BUDGET), record(landedFirst));
      assert.equal(ok(sb.git('show', `HEAD:${BUDGET}`)), record(landedFirst).trim());
    } finally {
      ok(git(origin, 'update-ref', 'refs/heads/main', restore));
      ok(git(other, 'reset', '-q', '--hard', restore));
      reset();
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
    assert.match(
      refused.stderr,
      /\(M0\.14: test: src\/feature\.txt\) may not land: M0\.14 changes src\/feature\.txt, which is not a harness path, and M0\.13 blocks landing/,
    );
    assert.equal(head(), start);
    assert.equal(remoteHead(), before);
    reset();
    reviewed('M0.15', 'scripts/gates/gate.txt', 'gate\n');
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

  it('while a row blocks landing, lands only harness-path commits and closes the row only with CI evidence for the tip (M18.135)', () => {
    reset();
    const BACKLOG = 'docs/backlog/current.md';
    upstream(BACKLOG, '| M0.13 | CI green `blocks-landing` | HARNESS | acceptance | | todo | |\n');
    reset();
    const runsFile = `${sb.dir}-runs.json`;
    // what GitHub reports for runs 1 (gates) and 2 (ci) of `sha`
    const runs = (sha) => {
      const job = (name) => ({ name, conclusion: 'success' });
      const ci = ['verify (ubuntu-latest)', 'verify (windows-latest)', 'verify (macos-latest)', 'visual', 'lighthouse'].map(job);
      writeFileSync(
        runsFile,
        JSON.stringify([
          { databaseId: 1, workflowName: 'gates', headSha: sha, conclusion: 'success', jobs: [job('gates')] },
          { databaseId: 2, workflowName: 'ci', headSha: sha, conclusion: 'success', jobs: ci },
        ]),
      );
    };
    const refusedBy = (why, pattern) => {
      const start = head();
      const before = remoteHead();
      const r = land('--push', '--ci-runs-file', runsFile);
      assert.equal(r.status, 1, `${why}: ${out(r)}`);
      assert.match(r.stderr, pattern);
      assert.equal(head(), start, why);
      assert.equal(remoteHead(), before, why);
      reset();
    };
    // a row added as HARNESS by an earlier harness-path commit does not let a later commit touching packages/ land
    reviewed('M0.17', BACKLOG, `${sb.read(BACKLOG)}| M0.17 | gate | HARNESS | acceptance | | todo | |\n`);
    const added = land('--push');
    assert.equal(added.status, 0, out(added));
    reviewed('M0.17', 'packages/core/src/x.ts', 'export {};\n');
    refusedBy('packages', /M0\.17 changes packages\/core\/src\/x\.ts, which is not a harness path/);
    // a commit under its own HARNESS row touching product or contract sources under scripts/ or docs/
    reviewed('M0.17', 'scripts/fonts/subset.mjs', 'x\n');
    refusedBy('scripts/fonts', /M0\.17 changes scripts\/fonts\/subset\.mjs, which is not a harness path/);
    // (docs/requirements/ would trip this sandbox's trace gate first; check-checkpoint's test covers it)
    reviewed('M0.17', 'docs/architecture/notes.md', 'x\n');
    refusedBy('docs/architecture', /M0\.17 changes docs\/architecture\/notes\.md, which is not a harness path/);
    // closing the blocking row needs a green three-OS record for the tip it lands on
    const done = () => sb.read(BACKLOG).replace('| todo |', '| done |');
    reviewed('M0.13', 'scripts/gates/close.txt', 'close\n', { [BACKLOG]: done() });
    refusedBy('no record', /M0\.13: it closes M0\.13 \(done, removed or unmarked\) without a green three-OS CI record/);
    const record = (sha) => `${JSON.stringify({ sha, runs: { gates: 1, ci: 2 } })}\n`;
    const close = () => {
      const tip = head();
      reviewed('M0.13', 'scripts/gates/close.txt', 'close\n', { [BACKLOG]: done(), '.harness/reviews/ci-evidence.json': record(tip) });
      return tip;
    };
    // another commit lands first, so the record, green for its own sha, no longer covers the tip
    runs(close());
    upstream('src/moved.txt', 'moved\n');
    refusedBy('a stale record', /without a green three-OS CI record for its parent or later/);
    // a record GitHub does not hold as green on that sha is not evidence (r1 F2)
    const tip = close();
    runs(ok(sb.git('rev-parse', `${tip}~1`)));
    refusedBy('a forged record', /without a green three-OS CI record/);
    runs(close());
    const closed = land('--push', '--ci-runs-file', runsFile);
    rmSync(runsFile, { force: true });
    assert.equal(closed.status, 0, out(closed));
    assert.equal(remoteHead(), head());
  });

  it('HARNESS: lands a planned ci fix through a blocking row once, and only for a real red run (M18.192, cp24 F3)', () => {
    reset();
    const BACKLOG = 'docs/backlog/current.md';
    const fixRow = (id, run) => `| ${id} | fix (ci ${run}) | FR-LIB-004 | the commit SHALL carry \`Fixes-ci: ${run}\` | | todo | |\n`;
    upstream(
      BACKLOG,
      `${sb.read(BACKLOG)}| M0.20 | CI green \`blocks-landing\` | HARNESS | acceptance | | todo | |\n${fixRow('M0.21', 501)}${fixRow('M0.22', 502)}`,
    );
    reset();
    const runsFile = `${sb.dir}-fix-runs.json`;
    // ci run 501 failed on the branch; GitHub has no run 502
    writeFileSync(runsFile, JSON.stringify([{ databaseId: 501, workflowName: 'ci', headSha: head(), conclusion: 'failure', jobs: [] }]));
    const refusedBy = (pattern) => {
      const start = head();
      const before = remoteHead();
      const r = land('--push', '--ci-runs-file', runsFile);
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, pattern);
      assert.equal(head(), start);
      assert.equal(remoteHead(), before);
      reset();
    };
    try {
      reviewed('M0.22', 'src/made-up.txt', 'x\n', { [TRAILER]: 'Fixes-ci: 502' });
      refusedBy(/M0\.22: its Fixes-ci exempts nothing: ci-run-red: run 502 was not found/);
      reviewed('M0.21', 'src/fix.txt', 'fix\n', { [TRAILER]: 'Fixes-ci: 501' });
      const fixed = land('--push', '--ci-runs-file', runsFile);
      assert.equal(fixed.status, 0, out(fixed));
      assert.equal(remoteHead(), head());
      reviewed('M0.21', 'src/fix.txt', 'fix again\n', { [TRAILER]: 'Fixes-ci: 501' });
      refusedBy(/a M0\.21 commit carrying Fixes-ci: 501 already landed; the exemption is spent/);
    } finally {
      rmSync(runsFile, { force: true });
    }
  });

  it("HARNESS: while main's ci is red, refuses a product commit and a stale Fixes-ci, and lands a Fixes-ci fix (M18.223, M18.225)", () => {
    reset();
    // the cases before leave M0.20 blocking; this one is about main's ci alone
    upstream('docs/backlog/current.md', sb.read('docs/backlog/current.md').replaceAll('`blocks-landing`', ''));
    reset();
    const runsFile = `${sb.dir}-red-runs.json`;
    // ci run 601 failed on the remote tip and is main's newest completed ci run
    const at = (sha) => ({ workflowName: 'ci', headSha: sha, status: 'completed', createdAt: '2026-11-02T10:00:00Z' });
    writeFileSync(
      runsFile,
      JSON.stringify([
        { databaseId: 601, ...at(remoteHead()), conclusion: 'failure', jobs: [{ name: 'verify (windows-latest)', conclusion: 'failure' }] },
        { databaseId: 602, ...at(remoteHead()), workflowName: 'gates', conclusion: 'success', jobs: [] },
      ]),
    );
    const refusedBy = (pattern) => {
      const start = head();
      const before = remoteHead();
      const r = land('--push', '--ci-runs-file', runsFile);
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, pattern);
      assert.equal(head(), start);
      assert.equal(remoteHead(), before);
      reset();
    };
    try {
      reviewed('M0.23', 'src/feature.txt', 'x\n');
      refusedBy(
        /M0\.23: test: src\/feature\.txt\) may not land: main's ci is red \(last-ci exit 1\) at run 601 \(ci at [0-9a-f]{7}: verify \(windows-latest\)\)/,
      );
      // a Fixes-ci naming a run that is not red now (stale, or never red) is refused (M18.225, cp33 F2)
      reviewed('M0.24', 'src/stale-fix.txt', 'x\n', { [TRAILER]: 'Fixes-ci: 599' });
      refusedBy(/M0\.24: test: src\/stale-fix\.txt\) may not land: its Fixes-ci: 599 names no run that is red now/);
      // (a harness-only commit's pass-through is ciRefusal's unit case; the sandbox's checkpoint budget allows two more task commits here)
      reviewed('M0.25', 'src/fix-red.txt', 'fix\n', { [TRAILER]: 'Fixes-ci: 601' });
      const fixed = land('--push', '--ci-runs-file', runsFile);
      assert.equal(fixed.status, 0, out(fixed));
      assert.equal(remoteHead(), head());
    } finally {
      rmSync(runsFile, { force: true });
    }
  });
});

describe("land reads main's ci again before the push (M18.265)", () => {
  let sb, remoteHead, head, land, reviewed, reset, cleanup;
  before(() => {
    ({ sb, remoteHead, head, land, reviewed, reset, cleanup } = landRig());
  });
  after(() => cleanup());

  it("HARNESS: main's ci is read again just before the push: turned red, the push is refused; still green, it is pushed (M18.265, cp42 F2)", () => {
    reset();
    const green = `${sb.dir}-green-runs.json`;
    const red = `${sb.dir}-late-red-runs.json`;
    writeFileSync(green, '[]');
    // ci run 701 fails on the remote tip while the commit is being gated
    const run = { databaseId: 701, workflowName: 'ci', headSha: remoteHead(), status: 'completed', createdAt: '2026-11-04T20:00:00Z' };
    writeFileSync(red, JSON.stringify([{ ...run, conclusion: 'failure', jobs: [{ name: 'verify (macos-latest)', conclusion: 'failure' }] }]));
    try {
      const start = reviewed('M0.26', 'src/late.txt', 'x\n');
      const before = remoteHead();
      const refused = land('--push', '--ci-runs-file', green, '--ci-runs-file-at-push', red);
      assert.equal(refused.status, 1, out(refused));
      assert.match(
        refused.stderr,
        /M0\.26: test: src\/late\.txt\) may not be pushed: main's ci changed while it was gated; main's ci is red \(last-ci exit 1\) at run 701 \(ci at [0-9a-f]{7}: verify \(macos-latest\)\)/,
      );
      // the local branch is back where it started and nothing was pushed
      assert.equal(head(), start);
      assert.equal(remoteHead(), before);
      const pushed = land('--push', '--ci-runs-file', green, '--ci-runs-file-at-push', green);
      assert.equal(pushed.status, 0, out(pushed));
      assert.equal(remoteHead(), head());
    } finally {
      rmSync(green, { force: true });
      rmSync(red, { force: true });
    }
  });
});
