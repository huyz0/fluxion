// NFR-DX-002: turbo pipelines are declared and each runs a real workspace script. The build and its
// cache hit are proven by the m1-complete build leg (dist artifacts, FULL TURBO on the second run),
// not here: a harness test must not rebuild the repo while the ladder reads dist/ (M1.36).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { REPO } from './helpers.mjs';

const { workspaces } = JSON.parse(readFileSync(join(REPO, 'tools/gen/workspaces.json'), 'utf8'));

describe('turbo pipelines (NFR-DX-002)', () => {
  it('declares typecheck and build, and every task is a script some workspace runs (M1 cp2 F5)', () => {
    const tasks = Object.keys(JSON.parse(readFileSync(join(REPO, 'turbo.json'), 'utf8')).tasks);
    for (const t of ['typecheck', 'build']) assert.ok(tasks.includes(t), t);
    // a task no workspace defines runs nothing and reports success (lint and tests are root runs)
    const scripts = new Set(workspaces.flatMap((w) => Object.keys(JSON.parse(readFileSync(join(REPO, w.dir, 'package.json'), 'utf8')).scripts ?? {})));
    // package-scoped overrides ("@fluxion/docs#build") name the script after the '#'
    for (const t of tasks) assert.ok(scripts.has(t.split('#').at(-1)), `turbo task ${t} has no workspace script`);
  });
});
