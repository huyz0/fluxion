// NFR-DX-001 / NFR-SEC-005 / NFR-MNT-001: the workspace root is reproducible and supply-chain safe.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { out, REPO, sandbox } from './helpers.mjs';

const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
const ws = readFileSync(join(REPO, 'pnpm-workspace.yaml'), 'utf8');

describe('workspace root (NFR-DX-001, NFR-SEC-005)', () => {
  it('pins pnpm 11 and a Node >= 22.14 floor', () => {
    assert.match(pkg.packageManager, /^pnpm@11\.\d+\.\d+$/);
    assert.equal(pkg.engines.node, '>=22.14');
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

  it('exposes setup, typecheck, verify and verify:fast scripts wired to the harness', () => {
    assert.equal(pkg.scripts.setup, 'node scripts/harness/setup.mjs');
    assert.equal(pkg.scripts.typecheck, 'tsc -b');
    assert.match(pkg.scripts.verify, /precommit\.mjs --all/);
    assert.match(pkg.scripts['verify:fast'], /precommit\.mjs --quick/);
  });
});

const { workspaces } = JSON.parse(readFileSync(join(REPO, 'tools/gen/workspaces.json'), 'utf8'));
const read = (p) => readFileSync(join(REPO, p), 'utf8');

describe('workspace packages (NFR-MNT-001, NFR-LIC-001)', () => {
  it('declares the 16 architecture packages plus studio, docs and the basic pack', () => {
    const libs = workspaces.filter((w) => w.dir.startsWith('packages/')).map((w) => w.name);
    assert.equal(libs.length, 16);
    assert.ok(libs.every((n) => n.startsWith('@fluxion/')));
    assert.deepEqual(workspaces.filter((w) => !w.dir.startsWith('packages/')).map((w) => w.dir), ['apps/studio', 'apps/docs', 'packs/basic']);
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
    assert.deepEqual(refs, workspaces.map((w) => w.dir));
  });

  it('generator --check fails when a workspace file is missing', () => {
    const sb = sandbox(['tools', 'tsconfig.json', ...workspaces.map((w) => w.dir)]);
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

  it('tsc -b type-checks every workspace (a type error in any project fails it)', () => {
    const sb = sandbox(['tsconfig.base.json', 'tsconfig.json', 'package.json', ...workspaces.map((w) => w.dir)]);
    try {
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
});
