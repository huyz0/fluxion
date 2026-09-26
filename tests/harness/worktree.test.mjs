// NFR-DX-003: one worktree per agent session; removing one never loses unmerged work.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { cleanEnv, out, sandbox } from './helpers.mjs';

let sb;
let wt;
const run = (...args) => sb.node('scripts/harness/worktree.mjs', args);

describe('worktree.mjs (NFR-DX-003)', () => {
  before(() => {
    sb = sandbox(['scripts'], { git: true });
    wt = join(dirname(sb.dir), `${basename(sb.dir)}-m1-drive`);
  });
  after(() => {
    rmSync(wt, { recursive: true, force: true });
    sb.cleanup();
  });

  it('creates a sibling worktree on agent/<slug>', () => {
    const r = run('create', 'm1-drive');
    assert.equal(r.status, 0, out(r));
    assert.ok(existsSync(join(wt, 'scripts')));
    assert.match(sb.git('-C', wt, 'branch', '--show-current').stdout, /agent\/m1-drive/);
    assert.match(run('list').stdout, /m1-drive/);
  });

  it('refuses to create the same worktree twice', () => {
    assert.equal(run('create', 'm1-drive').status, 1);
  });

  it('keeps an unmerged branch when removing with --delete-branch', () => {
    sb.git('-C', wt, 'commit', '--allow-empty', '-q', '-m', 'unmerged work', '--no-verify');
    const r = run('remove', 'm1-drive', '--delete-branch');
    assert.equal(r.status, 0, out(r));
    assert.ok(!existsSync(wt));
    assert.match(r.stdout, /kept agent\/m1-drive \(not merged\)/);
    assert.match(sb.git('branch', '--list', 'agent/m1-drive').stdout, /agent\/m1-drive/);
  });

  it('anchors on the main checkout when run from inside another worktree', () => {
    assert.equal(run('create', 'outer').status, 0);
    const outer = join(dirname(sb.dir), `${basename(sb.dir)}-outer`);
    const inner = join(dirname(sb.dir), `${basename(sb.dir)}-inner`);
    try {
      // the copy of the script inside the outer worktree, so REPO_ROOT is the outer worktree
      const r = spawnSync(process.execPath, [join(outer, 'scripts/harness/worktree.mjs'), 'create', 'inner'], { cwd: outer, encoding: 'utf8', env: cleanEnv() });
      assert.equal(r.status, 0, out(r));
      assert.ok(existsSync(inner), 'expected sibling of the main checkout');
      assert.equal(run('remove', 'inner').status, 0);
    } finally {
      run('remove', 'outer');
      rmSync(outer, { recursive: true, force: true });
      rmSync(inner, { recursive: true, force: true });
    }
  });

  it('deletes a merged branch with --delete-branch', () => {
    assert.equal(run('create', 'merged').status, 0);
    const r = run('remove', 'merged', '--delete-branch');
    assert.equal(r.status, 0, out(r));
    assert.match(r.stdout, /deleted merged branch agent\/merged/);
    assert.equal(sb.git('branch', '--list', 'agent/merged').stdout.trim(), '');
  });

  it('rejects bad input', () => {
    assert.equal(run('create', '../escape').status, 2);
    assert.equal(run('frobnicate', 'x').status, 2);
  });
});
