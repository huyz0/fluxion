// NFR-MNT-004: coverage floors from thresholds.mjs fail `test:coverage` for a package below them.
import assert from 'node:assert/strict';
import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';
import { cleanEnv, linkInstalls, out, REPO, sandbox } from './helpers.mjs';

const SHARED = [
  'tsconfig.json',
  'e2e',
  'vitest.config.ts',
  'tools/vitest',
  'tools/gen/workspaces.json',
  'scripts/gates/thresholds.mjs',
  'package.json',
  'tsconfig.base.json',
  'fixtures',
  // the security corpus the sanitiser tests read (M7.23)
  'specs/security',
  // the studio bundles the examples (M6.4)
  'examples',
];
// every workspace: tsconfig project references must resolve for Vite's tsconfig loader
const { workspaces } = JSON.parse(readFileSync(join(REPO, 'tools/gen/workspaces.json'), 'utf8'));
// untested branchy code: well under any floor once added to a package. Many copies, so the package
// drops below its floor however much tested code it already has (M3.10: core outgrew one copy).
const UNCOVERED = Array.from(
  { length: 400 },
  (_, i) => `export function grade${i}(n: number): string {
  if (n > 90) return 'a';
  if (n > 80) return 'b';
  if (n > 70) return 'c';
  if (n > 60) return 'd';
  return 'f';
}
`,
).join('\n');
let sb;
const added = [];

function coverage() {
  // node project only: the sandbox has no browser tests, and a browser launch would add seconds.
  // Few property runs, fixed seed: these cases test the floor mechanics, not property depth (the
  // ladder's own test step runs the full count), and a fixed seed keeps the covered lines stable.
  return sb.node('node_modules/vitest/vitest.mjs', ['run', '--coverage', '--project', 'node'], {
    env: cleanEnv({ ...process.env, FC_RUNS: '10', FC_SEED: '1' }),
  });
}
function addUncovered(dir) {
  const path = `${dir}/src/uncovered.ts`;
  sb.write(path, UNCOVERED);
  added.push(path);
}
/** One coverage run with uncovered code added to each of `dirs`, which is then removed again. */
function withUncovered(dirs) {
  for (const dir of dirs) addUncovered(dir);
  try {
    return coverage();
  } finally {
    for (const p of added.splice(0)) sb.write(p, 'export {};\n');
  }
}

// The sandbox runs the node project only (a browser launch per case would double this suite).
// Modules covered only by a sibling *.browser.test (stories, components) are not part of the floor
// mechanics tested here; the ladder's test step checks the real coverage with both projects.
/** A workspace's sources and configs, and the generated snapshots its tests compare against (CLI reply schemas, ADR-0147; SVG goldens, M4.19). */
function copyWorkspace(dir) {
  for (const f of ['src', 'package.json', 'tsconfig.json']) cpSync(join(REPO, dir, f), sb.path(`${dir}/${f}`), { recursive: true });
  for (const f of ['schemas', '__golden__']) if (existsSync(join(REPO, dir, f))) cpSync(join(REPO, dir, f), sb.path(`${dir}/${f}`), { recursive: true });
}

function dropBrowserCovered(src) {
  const files = readdirSync(sb.path(src));
  const stem = (f) => f.split('.')[0];
  const covered = new Set(files.filter((f) => /\.browser\.test\.tsx?$/.test(f)).map(stem));
  covered.delete('index');
  const dropped = files.filter((f) => covered.has(stem(f)));
  for (const f of dropped) rmSync(sb.path(`${src}/${f}`));
  // the package entry re-exports what was dropped: remove those re-exports so the entry still loads (M4.11)
  const index = `${src}/index.ts`;
  const gone = new Set(dropped.map(stem));
  if (gone.size > 0 && existsSync(sb.path(index)))
    sb.edit(index, (t) => t.replace(/export\s[^;]*?\sfrom\s+'\.\/([\w-]+)\.js';\n?/g, (m, name) => (gone.has(name) ? '' : m)));
}

describe('coverage floors (NFR-MNT-004)', () => {
  before(() => {
    sb = sandbox(SHARED);
    for (const { dir } of workspaces) copyWorkspace(dir);
    linkInstalls(sb);
    for (const { dir } of workspaces) dropBrowserCovered(`${dir}/src`);
    // e2e suites spawn a workspace's built bin (dist/, absent here) and cover no source (M4.17)
    for (const { dir } of workspaces) rmSync(sb.path(`${dir}/src/e2e`), { recursive: true, force: true });
  });
  after(() => sb.cleanup());
  afterEach(() => {
    for (const p of added.splice(0)) sb.write(p, 'export {};\n');
  });

  // Two coverage runs serve every case (each run takes seconds; one per case kept the ladder over
  // budget): one where every floored package meets its floor while cli (no floor) is uncovered,
  // and one where each floored package under test is uncovered at once. Every case asserts its
  // own package's outcome from the shared run.
  const runs = {};
  const passing = () => {
    runs.passing ??= withUncovered(['packages/cli']);
    return runs.passing;
  };
  const failing = () => {
    runs.failing ??= withUncovered(['packages/core', 'packages/render', 'packages/player', 'packages/editor']);
    return runs.failing;
  };

  it('passes when every package meets its floor', () => {
    const r = passing();
    assert.equal(r.status, 0, out(r));
  });

  it('fails when a pure package is below the floor', () => {
    const r = failing();
    assert.equal(r.status, 1, out(r));
    assert.match(`${r.stdout}${r.stderr}`, /Coverage for lines \([\d.]+%\) does not meet "packages\/core\/src\/\*\*" threshold \(90%\)/);
  });

  it('fails when render is below the floor (its own, lower floor)', () => {
    const r = failing();
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
      const r = failing();
      assert.equal(r.status, 1, out(r));
      assert.match(`${r.stdout}${r.stderr}`, new RegExp(`"${dir.replace('/', '\\/')}\\/src\\/\\*\\*" threshold \\(${floor}%\\)`));
    });
  }

  it('does not hold a package without a floor (cli) to one', () => {
    // cli is uncovered in the passing run
    const r = passing();
    assert.equal(r.status, 0, out(r));
  });
});
