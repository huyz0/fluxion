// NFR-DX-001 / NFR-SEC-005 / NFR-MNT-001: the workspace root is reproducible and supply-chain safe.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { linkInstalls, out, REPO, sandbox } from './helpers.mjs';

const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
const ws = readFileSync(join(REPO, 'pnpm-workspace.yaml'), 'utf8');

describe('workspace root (NFR-DX-001, NFR-SEC-005)', () => {
  it('pins pnpm 11 and a Node >= 22.19 floor (tsdown ^22.18, size-limit ^22.19)', () => {
    assert.match(pkg.packageManager, /^pnpm@11\.\d+\.\d+$/);
    assert.equal(pkg.engines.node, '>=22.19');
    assert.match(readFileSync(join(REPO, '.node-version'), 'utf8'), /^22\.\d+\.\d+/);
  });

  it('uses catalog: for every root dev dependency', () => {
    const notCatalog = Object.entries(pkg.devDependencies ?? {}).filter(([, v]) => v !== 'catalog:');
    assert.deepEqual(notCatalog, []);
  });

  it('pins exact catalog versions and a minimum release age of at least one day', () => {
    assert.match(ws, /^minimumReleaseAge: (\d+)$/m);
    assert.ok(Number(/^minimumReleaseAge: (\d+)$/m.exec(ws)[1]) >= 1440);
    const ranges = [...ws.matchAll(/^ {2}"?[@\w/.-]+"?: (\S+)/gm)].map((m) => m[1]).filter((v) => /^[\^~><*]/.test(v));
    assert.deepEqual(ranges, [], 'catalog entries must be exact versions');
  });

  it('exposes setup, typecheck, verify, verify:fast and the turbo pipeline scripts', () => {
    assert.equal(pkg.scripts.build, 'turbo run build');
    // one root Vitest run covers both projects and every package's coverage floor (M1.12)
    assert.equal(pkg.scripts.test, 'vitest run');
    assert.equal(pkg.scripts['test:coverage'], 'vitest run --coverage');
    assert.equal(pkg.scripts['test:related'], 'vitest related --run');
    // Biome lints the whole repo in one pass (M1.9); packages carry no per-package lint script
    assert.equal(pkg.scripts.lint, 'biome ci .');
    assert.equal(pkg.scripts.setup, 'node scripts/harness/setup.mjs');
    assert.equal(pkg.scripts.typecheck, 'tsc -b');
    assert.match(pkg.scripts.verify, /precommit\.mjs --all/);
    assert.match(pkg.scripts['verify:fast'], /precommit\.mjs --quick/);
  });
});

const { workspaces } = JSON.parse(readFileSync(join(REPO, 'tools/gen/workspaces.json'), 'utf8'));
const read = (p) => readFileSync(join(REPO, p), 'utf8');

describe('workspace packages (NFR-MNT-001, NFR-LIC-001, NFR-MNT-002)', () => {
  it('declares the architecture packages plus studio, docs and the first-party packs', () => {
    const libs = workspaces.filter((w) => w.dir.startsWith('packages/')).map((w) => w.name);
    // every library is a row of the overview's package map (a table row `| L<n> | `name` | ...`), and the map has no library the manifest lacks
    const mapped = [...read('docs/architecture/01-overview.md').matchAll(/^\| L\d \| `([a-z-]+)`/gm)].map((m) => m[1]);
    const names = libs.map((n) => n.replace('@fluxion/', ''));
    assert.ok(names.length >= 16);
    assert.deepEqual([...names].sort(), [...mapped].filter((n) => !n.includes('exporters (R7)')).sort());
    assert.ok(libs.every((n) => n.startsWith('@fluxion/')));
    const others = workspaces.filter((w) => !w.dir.startsWith('packages/')).map((w) => w.dir);
    assert.deepEqual(others.slice(0, 2), ['apps/studio', 'apps/docs']);
    // a new first-party pack is listed in workspaces.json and the architecture overview, not in this test
    assert.ok(others.slice(2).every((d) => d.startsWith('packs/')));
    for (const pack of ['packs/basic', 'packs/themes-core', 'packs/fonts-core']) assert.ok(others.includes(pack), pack);
  });

  for (const w of workspaces) {
    it(`${w.dir} has index.ts, README, AGENTS (<= 60 lines), LICENSE and a source-first exports map`, () => {
      for (const f of ['src/index.ts', 'README.md', 'AGENTS.md', 'LICENSE']) assert.ok(existsSync(join(REPO, w.dir, f)), `${w.dir}/${f}`);
      assert.ok(read(`${w.dir}/AGENTS.md`).split('\n').length <= 60);
      assert.match(read(`${w.dir}/LICENSE`), /^MIT License/);
      const p = JSON.parse(read(`${w.dir}/package.json`));
      assert.equal(p.name, w.name);
      assert.equal(p.sideEffects, false);
      assert.deepEqual(Object.keys(p.exports['.']), ['@fluxion/source', 'types', 'default']);
    });
  }

  it('has a root MIT LICENSE', () => {
    assert.match(read('LICENSE'), /^MIT License/);
  });

  it('references every workspace from the root solution tsconfig', () => {
    const refs = JSON.parse(read('tsconfig.json')).references.map((r) => r.path.replace(/^\.\//, ''));
    // plus the e2e project, so Playwright specs are type-checked too (M1.16)
    assert.deepEqual(refs, [...workspaces.map((w) => w.dir), 'e2e']);
  });

  it('generator --check fails when a workspace file is missing', () => {
    const sb = sandbox(['tools', 'tsconfig.json', 'e2e', ...workspaces.map((w) => w.dir)]);
    try {
      assert.equal(sb.node('tools/gen/package.mjs', ['--check']).status, 0);
      rmSync(sb.path('packages/core/AGENTS.md'));
      const r = sb.node('tools/gen/package.mjs', ['--check']);
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, /missing packages\/core\/AGENTS\.md/);
    } finally {
      sb.cleanup();
    }
  });

  it('generated files already match the formatter (M1.9 review F1)', () => {
    const sb = sandbox(['tools', 'tsconfig.json', 'biome.json', ...workspaces.map((w) => w.dir)]);
    try {
      // the sandbox is not a git repo: same rules, VCS integration off
      sb.edit('biome.json', (t) => JSON.stringify({ ...JSON.parse(t), $schema: undefined, vcs: { enabled: false } }));
      for (const f of ['package.json', 'tsconfig.json', 'tsdown.config.ts', 'src/index.ts']) rmSync(sb.path(`packages/core/${f}`));
      const gen = sb.node('tools/gen/package.mjs', ['packages/core'], { env: { ...process.env, FLUXION_TOOLS_ROOT: REPO } });
      assert.equal(gen.status, 0, out(gen));
      const biome = join(REPO, 'node_modules', '@biomejs', 'biome', 'bin', 'biome');
      const r = spawnSync(process.execPath, [biome, 'ci', '--colors=off', 'packages/core'], { cwd: sb.dir, encoding: 'utf8' });
      assert.equal(r.status, 0, out(r));
    } finally {
      sb.cleanup();
    }
  });

  it('tsc -b type-checks every workspace (a type error in any project fails it)', () => {
    const sb = sandbox(['tsconfig.base.json', 'tsconfig.json', 'package.json', 'e2e', ...workspaces.map((w) => w.dir)]);
    try {
      // node-runtime workspaces resolve @types/node from the repo's install
      linkInstalls(sb);
      const tsc = join(REPO, 'node_modules', 'typescript', 'bin', 'tsc');
      const good = spawnSync(process.execPath, [tsc, '-b'], { cwd: sb.dir, encoding: 'utf8' });
      assert.equal(good.status, 0, out(good));
      sb.write('packs/basic/src/broken.ts', 'export const n: number = "not a number";\n');
      const bad = spawnSync(process.execPath, [tsc, '-b'], { cwd: sb.dir, encoding: 'utf8' });
      assert.notEqual(bad.status, 0, out(bad)); // tsc -b exits 2 on type errors
      assert.match(bad.stdout, /packs\/basic\/src\/broken\.ts.*TS2322/);
    } finally {
      sb.cleanup();
    }
  });

  it('pure packages type-check without DOM; dom and node runtimes get their globals (M1 cp1 F5)', () => {
    const sb = sandbox(['tsconfig.base.json', 'tsconfig.json', 'package.json', 'e2e', ...workspaces.map((w) => w.dir)]);
    try {
      linkInstalls(sb);
      const tsc = join(REPO, 'node_modules', 'typescript', 'bin', 'tsc');
      sb.write('packages/render/src/dom.ts', 'export const title = (): string => document.title;\n');
      sb.write('packages/cli/src/env.ts', "export const home = (): string | undefined => process.env['HOME'];\n");
      const ok = spawnSync(process.execPath, [tsc, '-b'], { cwd: sb.dir, encoding: 'utf8' });
      assert.equal(ok.status, 0, out(ok));
      sb.write('packages/core/src/dom.ts', 'export const title = (): string => document.title;\n');
      const bad = spawnSync(process.execPath, [tsc, '-b'], { cwd: sb.dir, encoding: 'utf8' });
      assert.notEqual(bad.status, 0, out(bad));
      assert.match(bad.stdout, /packages\/core\/src\/dom\.ts.*(TS2584|TS2304)/);
    } finally {
      sb.cleanup();
    }
  });

  it('generator --check fails when a tsconfig lib/types/references drift from workspaces.json', () => {
    const sb = sandbox(['tools', 'tsconfig.json', 'e2e', ...workspaces.map((w) => w.dir)]);
    try {
      sb.edit('packages/core/tsconfig.json', (t) => t.replace('"lib": ["ES2023"]', '"lib": ["ES2023", "DOM"]'));
      const r = sb.node('tools/gen/package.mjs', ['--check']);
      assert.equal(r.status, 1, out(r));
      assert.match(r.stderr, /packages\/core\/tsconfig\.json lib\/types\/references out of sync/);
    } finally {
      sb.cleanup();
    }
  });
});
