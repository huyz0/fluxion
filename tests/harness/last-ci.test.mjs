// M5.2 (M4 final F3, NFR-DX-003): the loop reads main's last CI before a task.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { REPO } from './helpers.mjs';

/** Runs last-ci.mjs against `runs` (gh run list shape); returns its status and output. */
function lastCi(runs) {
  const dir = mkdtempSync(join(tmpdir(), 'last-ci-'));
  try {
    const file = join(dir, 'runs.json');
    writeFileSync(file, JSON.stringify(runs));
    const r = spawnSync(process.execPath, [join(REPO, 'scripts/harness/last-ci.mjs'), '--runs-file', file], { encoding: 'utf8' });
    return { status: r.status, out: r.stdout + r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
/** A run in gh shape; `state` is the conclusion of a completed run, or queued / in_progress. */
const run = (workflowName, state, createdAt, headSha = 'abcdef1234567') => {
  const pending = state === 'queued' || state === 'in_progress';
  return { databaseId: createdAt.length, workflowName, headSha, status: pending ? state : 'completed', conclusion: pending ? null : state, createdAt };
};

describe('last-ci (M5.2, M4 final F3)', () => {
  it('a red last run on main blocks the next task', () => {
    const r = lastCi([
      run('ci', 'failure', '2026-09-29T02:00:00Z', 'deadbee0000000'),
      run('ci', 'success', '2026-09-29T01:00:00Z'),
      run('gates', 'success', '2026-09-29T02:00:00Z'),
    ]);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /RED ci failure at deadbee/);
    // a red run with a newer run pending is not green either: exit 2 means wait for that run, do not re-fix
    const hidden = lastCi([run('ci', 'in_progress', '2026-09-29T03:00:00Z'), run('ci', 'failure', '2026-09-29T02:00:00Z')]);
    assert.equal(hidden.status, 2, hidden.out);
    assert.match(hidden.out, /1 newer run pending\): wait for the pending run/);
    // one workflow red with nothing pending still blocks outright, whatever the other waits for
    const both = lastCi([
      run('ci', 'in_progress', '2026-09-29T03:00:00Z'),
      run('ci', 'failure', '2026-09-29T02:00:00Z'),
      run('gates', 'failure', '2026-09-29T02:00:00Z'),
    ]);
    assert.equal(both.status, 1, both.out);
    // a pending run older than the red one cannot hold its fix: red, not wait
    const older = lastCi([run('ci', 'failure', '2026-09-29T03:00:00Z'), run('ci', 'in_progress', '2026-09-29T02:00:00Z')]);
    assert.equal(older.status, 1, older.out);
    assert.doesNotMatch(older.out, /pending/);
    // a cancelled or timed-out run is not green either
    assert.equal(lastCi([run('gates', 'cancelled', '2026-09-29T02:00:00Z')]).status, 1);
  });

  it('a green or pending last run lets the task start', () => {
    const green = lastCi([
      run('ci', 'success', '2026-09-29T02:00:00Z'),
      run('ci', 'failure', '2026-09-29T01:00:00Z'),
      run('gates', 'success', '2026-09-29T02:00:00Z'),
    ]);
    assert.equal(green.status, 0, green.out);
    assert.match(green.out, /ci green at abcdef1/);
    // only pending runs, or none at all: nothing to fix yet
    assert.equal(lastCi([run('ci', 'queued', '2026-09-29T02:00:00Z')]).status, 0);
    assert.equal(lastCi([]).status, 0);
  });
});
