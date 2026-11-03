// HARNESS NFR-PORT-005: CI may split the full ladder across jobs only so that together they run every leg (ADR-0214, M18.256).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { listFlag, splitLadder } from '../../scripts/gates/ladder-split.mjs';

const names = ['size', 'typecheck', 'build', 'harness-tests', 'lint', 'test', 'api'];
const o = (extra) => ({ mode: 'all', barrier: 'build', known: [...names, 'reviewed'], ...extra });

describe('splitting the full ladder across CI jobs (ADR-0214)', () => {
  it('--skip leaves the named legs to another job; --only keeps them and the ordered prefix up to build; together every leg runs once', () => {
    const skip = splitLadder(names, o({ skip: ['harness-tests'] }));
    const only = splitLadder(names, o({ only: ['harness-tests'] }));
    assert.ok('off' in skip && 'off' in only);
    assert.deepEqual([...skip.off.keys()], ['harness-tests']);
    assert.deepEqual([...only.off.keys()], ['lint', 'test', 'api']);
    assert.match(skip.off.get('harness-tests') ?? '', /--skip: run by another CI job/);
    // every leg after the barrier runs in exactly one of the two jobs
    for (const n of names.slice(3)) assert.equal(Number(!skip.off.has(n)) + Number(!only.off.has(n)), 1, n);
    assert.deepEqual([...splitLadder(names, o({})).off], []);
  });

  it('refuses a split outside --all, both flags, an empty list or a leg that does not exist, rather than skipping silently', () => {
    assert.match(splitLadder(names, o({ skip: ['lint'], mode: 'staged' })).error, /need --all/);
    assert.match(splitLadder(names, o({ skip: ['lint'], only: ['test'] })).error, /not both/);
    assert.match(splitLadder(names, o({ only: [] })).error, /empty list/);
    assert.match(splitLadder(names, o({ skip: ['lnit'] })).error, /lnit/);
    assert.deepEqual(listFlag(['--all', '--skip', 'a,b'], '--skip'), ['a', 'b']);
    assert.equal(listFlag(['--all'], '--skip'), undefined);
    const run = spawnSync(process.execPath, ['scripts/gates/precommit.mjs', '--staged', '--skip', 'lint'], { encoding: 'utf8' });
    assert.equal(run.status, 2);
    assert.match(run.stderr, /need --all/);
  });
});
