// HARNESS, NFR-REL-002: a fast-check seed that refused a staged run is replayed until fixed, not re-rolled (M18.275, cp45 F2).
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { hasRecords, parseFastCheckFailures, readRecords, recordFailures, replayCommand, replayRecorded, storePath } from '../../scripts/gates/fc-replay.mjs';
import { sandbox } from './helpers.mjs';

// the shape Vitest printed for M18.271's refused land (seed 1397724349)
const FAILED = [
  ' ❯ |node| packages/schema/src/parse-robust.test.ts (9 tests | 1 failed) 251ms',
  ' FAIL  |node| packages/schema/src/parse-robust.test.ts > robust parse (NFR-REL-002) > NFR-REL-002: parse never throws on corrupted input',
  'Error: Property failed after 126 tests',
  '{ seed: 1397724349, path: "125:0:3:5:8:10:12:13:13:13:13", endOnFailure: true }',
  'Counterexample: ["{}"]',
  ' FAIL  |browser (chromium)| packages/editor/src/a.browser.test.tsx > x',
  'AssertionError: expected 1 to be 2',
].join('\n');

describe('fast-check seed replay (M18.275)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fc-replay-'));
  const store = join(dir, 'fluxion-fc-failures.json');
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("reads each failure's seed, path and test file, and nothing from a failure without a seed", () => {
    assert.deepEqual(parseFastCheckFailures(FAILED), [
      { file: 'packages/schema/src/parse-robust.test.ts', seed: 1397724349, path: '125:0:3:5:8:10:12:13:13:13:13' },
    ]);
    assert.deepEqual(parseFastCheckFailures('Tests  9 passed (9)'), []);
    // a coloured header (FORCE_COLOR, win32) and a Windows path read the same (r1 F3)
    const coloured = FAILED.replace(
      ' FAIL  |node| packages/schema/src/parse-robust.test.ts',
      ' \u001b[31mFAIL\u001b[39m  \u001b[30m|node|\u001b[39m packages\\schema\\src\\parse-robust.test.ts',
    );
    assert.deepEqual(parseFastCheckFailures(coloured), parseFastCheckFailures(FAILED));
    const two = `${FAILED}\n FAIL  |node| packages/core/src/b.test.ts > y\n{ seed: -7, path: "3", endOnFailure: true }`;
    assert.deepEqual(
      parseFastCheckFailures(two).map((f) => [f.file, f.seed]),
      [
        ['packages/schema/src/parse-robust.test.ts', 1397724349],
        ['packages/core/src/b.test.ts', -7],
      ],
    );
  });

  it("replays a record with its seed pinned on its own file, without the hook's GIT_ variables (r1 F4)", () => {
    const c = replayCommand({ file: 'packages/schema/src/parse-robust.test.ts', seed: 1397724349, path: '1' }, { PATH: '/bin', GIT_DIR: '/x', FC_SEED: '5' });
    assert.deepEqual([c.cmd, ...c.args], ['pnpm', 'exec', 'vitest', 'run', 'packages/schema/src/parse-robust.test.ts']);
    assert.equal(c.env.FC_SEED, '1397724349');
    assert.equal(c.env.GIT_DIR, undefined);
    assert.match(c.env.FLUXION_VITEST_CACHE, /fc-replay$/);
  });

  it('refuses a run while the recorded seed still fails, though a fresh seed would pass, and drops it once fixed', async () => {
    assert.equal(recordFailures(FAILED, store).length, 1);
    assert.equal(recordFailures(FAILED, store).length, 0, 'the same failure is recorded once');
    let fixed = false;
    // the property fails only on the recorded seed until it is fixed; any other seed passes
    const run = ({ seed }) => Promise.resolve({ status: !fixed && seed === 1397724349 ? 1 : 0 });
    const present = () => true;
    assert.equal((await run({ seed: 42 })).status, 0, 'a fresh seed passes');
    const refused = await replayRecorded({ path: store, run, present });
    assert.equal(refused.status, 1);
    assert.match(
      refused.stdout,
      /fast-check seed 1397724349 \(path "125:0:3:5:8:10:12:13:13:13:13"\) still fails packages\/schema\/src\/parse-robust\.test\.ts/,
    );
    assert.match(refused.stdout, /FC_SEED=1397724349 pnpm exec vitest run packages\/schema\/src\/parse-robust\.test\.ts/);
    assert.equal(readRecords(store).length, 1, 'the record stays while the seed fails');
    fixed = true;
    const passed = await replayRecorded({ path: store, run, present });
    assert.equal(passed.status, 0);
    assert.match(passed.stdout, /seed 1397724349 passes .* record dropped/);
    assert.deepEqual(JSON.parse(readFileSync(store, 'utf8')), []);
  });

  it('refuses an unreadable store instead of reading it as empty, and keeps it (r1 F2)', async () => {
    const bad = join(dir, 'bad.json');
    for (const text of ['[{"file":"a.test.ts","se', '{}', '[{}]', '[null]']) {
      writeFileSync(bad, text);
      assert.equal(hasRecords(bad), true, text);
      const r = await replayRecorded({ path: bad, run: () => Promise.resolve({ status: 0 }), present: () => true });
      assert.equal(r.status, 1, text);
      assert.match(r.stdout, /fix or delete it/);
      assert.equal(readFileSync(bad, 'utf8'), text, 'the store is left as it was');
      assert.deepEqual(recordFailures(FAILED, bad), []);
    }
  });

  it('keeps a record another worktree adds while a replay runs, and names the replay output of a seed that still fails (r1 F2, F5)', async () => {
    const shared = join(dir, 'shared.json');
    recordFailures(FAILED, shared);
    const other = FAILED.replace('1397724349', '99');
    const run = () => {
      recordFailures(other, shared);
      return Promise.resolve({ status: 1, stdout: 'Error: Property failed after 3 tests\nCounterexample: [1]', stderr: '' });
    };
    const r = await replayRecorded({ path: shared, run, present: () => true });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /Counterexample: \[1\]/);
    assert.deepEqual(
      readRecords(shared).map((x) => x.seed),
      [1397724349, 99],
    );
    const fixed = await replayRecorded({ path: shared, run: () => Promise.resolve({ status: 0 }), present: () => true });
    assert.equal(fixed.status, 0);
    assert.equal(hasRecords(shared), false);
  });

  it("keeps another worktree's record that this tree passes or lacks, and drops it once that worktree is gone (r2 F1)", async () => {
    const shared = join(dir, 'owned.json');
    recordFailures(FAILED, shared, '/wt/a');
    assert.equal(readRecords(shared)[0].worktree, '/wt/a');
    const pass = () => Promise.resolve({ status: 0 });
    const alive = (w) => w === '/wt/a' || w === '/wt/b';
    for (const present of [() => true, () => false]) {
      const r = await replayRecorded({ path: shared, run: pass, present, worktree: '/wt/b', worktreeExists: alive });
      assert.equal(r.status, 0);
      assert.match(r.stdout, /record kept for \/wt\/a/);
      assert.equal(readRecords(shared).length, 1);
    }
    // stream B's tree still holds the defect: refused there too
    const red = await replayRecorded({
      path: shared,
      run: () => Promise.resolve({ status: 1 }),
      present: () => true,
      worktree: '/wt/b',
      worktreeExists: alive,
    });
    assert.equal(red.status, 1);
    // the recording worktree drops it once it passes there
    const mine = await replayRecorded({ path: shared, run: pass, present: () => true, worktree: '/wt/a', worktreeExists: alive });
    assert.match(mine.stdout, /record dropped/);
    assert.equal(hasRecords(shared), false);
    // a record whose worktree was removed is dropped by any worktree that passes it
    recordFailures(FAILED, shared, '/wt/gone');
    await replayRecorded({ path: shared, run: pass, present: () => true, worktree: '/wt/b', worktreeExists: alive });
    assert.equal(hasRecords(shared), false);
  });

  it('reports a store it cannot write instead of crashing, and leaves no temporary file (r2 F2)', () => {
    const missing = join(dir, 'no-such-dir', 'store.json');
    assert.throws(() => recordFailures(FAILED, missing), /fc-replay: could not write .*store\.json/);
    assert.ok(!existsSync(join(dir, 'no-such-dir')));
    assert.deepEqual(
      readdirSync(dir).filter((f) => f.endsWith('.tmp')),
      [],
    );
  });

  it('drops a record whose test file is gone', async () => {
    recordFailures(FAILED, store);
    const r = await replayRecorded({ path: store, run: () => Promise.resolve({ status: 1 }), present: () => false });
    assert.equal(r.status, 0);
    assert.deepEqual(readRecords(store), []);
  });

  it('keeps the store under the git common directory, which every worktree of the clone shares', () => {
    const sb = sandbox([], { git: true });
    try {
      const wt = join(sb.dir, '..', `${sb.dir.split(/[\\/]/).pop()}-wt`);
      assert.equal(sb.git('worktree', 'add', '-q', wt).status, 0);
      try {
        assert.equal(storePath(wt), storePath(sb.dir));
        assert.ok(storePath(sb.dir).endsWith(join('.git', 'fluxion-fc-failures.json')));
        assert.ok(!existsSync(storePath(sb.dir)));
      } finally {
        sb.git('worktree', 'remove', '--force', wt);
      }
    } finally {
      sb.cleanup();
    }
  });
});

describe('the staged ladder replays recorded seeds in a step of its own (M18.275, r1 F1)', () => {
  it('precommit.mjs runs fc-replay in staged mode whatever is staged, and the test step records a failed run', () => {
    const src = readFileSync(new URL('../../scripts/gates/precommit.mjs', import.meta.url), 'utf8');
    assert.match(src, /\['fc-replay', \(m\) => m === 'staged', \(\) => hasRecords\(\) \|\| 'no recorded fast-check seed', \(\) => replayRecorded\(\)\]/);
    const step = src.slice(src.indexOf("'test',"), src.indexOf("'fc-replay'"));
    assert.match(step, /if \(mode === 'staged' && result\.status !== 0\) \{\s*try \{\s*recordFailures\(/);
  });
});
