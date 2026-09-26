// NFR-MNT-004: coverage floors from thresholds.mjs fail `test:coverage` for a package below them.
import assert from 'node:assert/strict';
import { cpSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';
import { cleanEnv, out, REPO, sandbox } from './helpers.mjs';

const SHARED = [
  'tsconfig.json',
  'vitest.config.ts',
  'tools/vitest',
  'tools/gen/workspaces.json',
  'scripts/gates/thresholds.mjs',
  'package.json',
  'tsconfig.base.json',
];
// every workspace: tsconfig project references must resolve for Vite's tsconfig loader
const { workspaces } = JSON.parse(readFileSync(join(REPO, 'tools/gen/workspaces.json'), 'utf8'));
// untested branchy code: well under any floor once added to a package
const UNCOVERED = `export function grade(n: number): string {
  if (n > 90) return 'a';
  if (n > 80) return 'b';
  if (n > 70) return 'c';
  if (n > 60) return 'd';
  return 'f';
}
`;
let sb;
const added = [];

function coverage() {
  // node project only: the sandbox has no browser tests, and a browser launch would add seconds
  return sb.node('node_modules/vitest/vitest.mjs', ['run', '--coverage', '--project', 'node'], { env: cleanEnv() });
}
function addUncovered(dir) {
  const path = `${dir}/src/uncovered.ts`;
  sb.write(path, UNCOVERED);
  added.push(path);
}

describe('coverage floors (NFR-MNT-004)', () => {
  before(() => {
    sb = sandbox(SHARED);
    for (const { dir } of workspaces) {
      for (const f of ['src', 'package.json', 'tsconfig.json']) cpSync(join(REPO, dir, f), sb.path(`${dir}/${f}`), { recursive: true });
    }
    symlinkSync(join(REPO, 'node_modules'), sb.path('node_modules'), 'junction');
  });
  after(() => sb.cleanup());
  afterEach(() => {
    for (const p of added.splice(0)) sb.write(p, 'export {};\n');
  });

  it('passes when every package meets its floor', () => {
    const r = coverage();
    assert.equal(r.status, 0, out(r));
  });

  it('fails when a pure package is below the floor', () => {
    addUncovered('packages/core');
    const r = coverage();
    assert.equal(r.status, 1, out(r));
    assert.match(`${r.stdout}${r.stderr}`, /Coverage for lines \([\d.]+%\) does not meet "packages\/core\/src\/\*\*" threshold \(90%\)/);
  });

  it('fails when render is below the floor (its own, lower floor)', () => {
    addUncovered('packages/render');
    const r = coverage();
    assert.equal(r.status, 1, out(r));
    assert.match(`${r.stdout}${r.stderr}`, /"packages\/render\/src\/\*\*" threshold \(80%\)/);
  });

  it('passes FC_SEED and FC_RUNS to fast-check, so property failures replay (testing.md §4)', () => {
    const probe = 'packages/core/src/seed.test.ts';
    sb.write(
      probe,
      "import fc from 'fast-check';\nimport { expect, it } from 'vitest';\n\nit('seed probe', () => {\n  expect(fc.readConfigureGlobal()).toMatchObject({ seed: 4242, numRuns: 7 });\n});\n",
    );
    try {
      const r = sb.node('node_modules/vitest/vitest.mjs', ['run', '--project', 'node', probe], {
        env: cleanEnv({ ...process.env, FC_SEED: '4242', FC_RUNS: '7' }),
      });
      assert.equal(r.status, 0, out(r));
      assert.match(r.stdout, /1 passed/);
    } finally {
      sb.write(probe, "import { it } from 'vitest';\n\nit('seed probe placeholder', () => {});\n");
    }
  });

  for (const [dir, floor] of [
    ['packages/player', 80],
    ['packages/editor', 70],
  ]) {
    it(`fails when ${dir.split('/')[1]} is below its floor (M1 cp2 F7)`, () => {
      addUncovered(dir);
      const r = coverage();
      assert.equal(r.status, 1, out(r));
      assert.match(`${r.stdout}${r.stderr}`, new RegExp(`"${dir.replace('/', '\\/')}\\/src\\/\\*\\*" threshold \\(${floor}%\\)`));
    });
  }

  it('does not hold a package without a floor (cli) to one', () => {
    addUncovered('packages/cli');
    const r = coverage();
    assert.equal(r.status, 0, out(r));
  });
});
