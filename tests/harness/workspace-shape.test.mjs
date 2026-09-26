// NFR-DX-001 / NFR-SEC-005 / NFR-MNT-001: the workspace root is reproducible and supply-chain safe.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { REPO } from './helpers.mjs';

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

  it('exposes setup, verify and verify:fast scripts wired to the harness', () => {
    assert.equal(pkg.scripts.setup, 'node scripts/harness/setup.mjs');
    assert.match(pkg.scripts.verify, /precommit\.mjs --all/);
    assert.match(pkg.scripts['verify:fast'], /precommit\.mjs --quick/);
  });
});
