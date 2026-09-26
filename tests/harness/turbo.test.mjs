// NFR-DX-002: turbo pipelines are cached — an unchanged rebuild is a full cache hit.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { cleanEnv, out, REPO } from './helpers.mjs';

const turbo = (...args) =>
  spawnSync(process.execPath, [join(REPO, 'node_modules', 'turbo', 'bin', 'turbo'), ...args], { cwd: REPO, encoding: 'utf8', env: cleanEnv() });
const { workspaces } = JSON.parse(readFileSync(join(REPO, 'tools/gen/workspaces.json'), 'utf8'));
const libraries = workspaces.filter((w) => w.dir.startsWith('packages/') || w.dir.startsWith('packs/'));

describe('turbo pipelines (NFR-DX-002)', () => {
  it('declares typecheck, build, test, test:coverage, test:related and lint tasks', () => {
    const tasks = Object.keys(JSON.parse(readFileSync(join(REPO, 'turbo.json'), 'utf8')).tasks);
    for (const t of ['typecheck', 'build', 'test', 'test:coverage', 'test:related', 'lint']) assert.ok(tasks.includes(t), t);
  });

  it('builds every library to dist/index.js + index.d.ts and reruns as a full cache hit', () => {
    const first = turbo('run', 'build');
    assert.equal(first.status, 0, out(first));
    for (const w of libraries) {
      assert.ok(existsSync(join(REPO, w.dir, 'dist', 'index.js')), `${w.dir}/dist/index.js`);
      assert.ok(existsSync(join(REPO, w.dir, 'dist', 'index.d.ts')), `${w.dir}/dist/index.d.ts`);
    }
    const second = turbo('run', 'build');
    assert.equal(second.status, 0, out(second));
    assert.match(second.stdout, /FULL TURBO/);
  });
});
