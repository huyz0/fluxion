// Pack golden legs fail closed (M18.100, M18.102, FR-LIB-007, HARNESS): the real basic pack suite runs in a sandbox that links the
// installed workspace and copies only packs/basic, so deleting or adding a golden there cannot touch the checkout.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { out, REPO } from './helpers.mjs';

const LINKED = ['node_modules', 'packages', 'tools', 'scripts', 'package.json', 'tsconfig.json', 'tsconfig.base.json', 'vitest.config.ts'];
const SUITE = 'packs/basic/src/pack.test.ts';

function packSandbox() {
  const dir = mkdtempSync(join(realpathSync.native(tmpdir()), 'fluxion-pack-goldens-'));
  for (const p of LINKED) symlinkSync(join(REPO, p), join(dir, p), process.platform === 'win32' ? 'junction' : undefined);
  // the pack's own node_modules links are relative (../../../packages/sdk), so they resolve through the linked packages/
  cpSync(join(REPO, 'packs/basic'), join(dir, 'packs/basic'), {
    recursive: true,
    verbatimSymlinks: true,
    filter: (src) => !/[\\/](dist|\.tsbuild|coverage)$/.test(src),
  });
  const clean = (extra = {}) => {
    const env = { ...process.env, FLUXION_VITEST_CACHE: join(dir, '.vitest-cache') };
    for (const key of ['CI', 'VITE_FLUXION_WRITE_PACK']) delete env[key];
    return { ...env, ...extra };
  };
  const run = (extra) =>
    spawnSync(process.execPath, [join(REPO, 'node_modules/vitest/vitest.mjs'), 'run', '--project', 'node', SUITE], {
      cwd: dir,
      encoding: 'utf8',
      env: clean(extra),
    });
  const sync = () => spawnSync(process.execPath, [join(REPO, 'scripts/packs/sync-versions.mjs'), 'packs/basic'], { cwd: dir, encoding: 'utf8', env: clean() });
  return { dir, run, sync, cleanup: () => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) };
}

describe('pack golden legs (M18.100, M18.102, FR-LIB-007, HARNESS)', () => {
  it('a deleted golden fails the pack suite outside CI and is not written back; an orphan golden fails too', () => {
    const sb = packSandbox();
    try {
      const baseline = sb.run();
      assert.equal(baseline.status, 0, out(baseline));
      assert.match(baseline.stdout, /Tests\s+1 passed \(1\)/, out(baseline));
      const golden = join(sb.dir, 'packs/basic/__golden__/rect.svg');
      rmSync(golden);
      const missing = sb.run();
      assert.notEqual(missing.status, 0, out(missing));
      assert.match(missing.stdout + missing.stderr, /__golden__\/rect\.svg is missing/);
      assert.equal(existsSync(golden), false, 'a gate run wrote the deleted golden back');
      cpSync(join(REPO, 'packs/basic/__golden__/rect.svg'), golden);
      writeFileSync(join(sb.dir, 'packs/basic/__golden__/orphan.svg'), '<svg/>\n');
      const orphan = sb.run();
      assert.notEqual(orphan.status, 0, out(orphan));
      assert.match(orphan.stdout + orphan.stderr, /__golden__\/orphan\.svg belongs to no definition/);
    } finally {
      sb.cleanup();
    }
  });

  it('the write variable without -u, as a leaked gate environment, fails and writes no missing golden (M18.110)', () => {
    const sb = packSandbox();
    try {
      const golden = join(sb.dir, 'packs/basic/__golden__/rect.svg');
      rmSync(golden);
      const leaked = sb.run({ VITE_FLUXION_WRITE_PACK: '1' });
      assert.notEqual(leaked.status, 0, out(leaked));
      assert.match(leaked.stdout + leaked.stderr, /needs `vitest run -u`/);
      assert.equal(existsSync(golden), false, 'a run without -u wrote the deleted golden');
    } finally {
      sb.cleanup();
    }
  });

  it('after changeset version, the sync script gives the pack its new version and ledger; changed geometry or a removed released entry fails (M18.110)', () => {
    const sb = packSandbox();
    try {
      const pkgPath = join(sb.dir, 'packs/basic/package.json');
      writeFileSync(pkgPath, readFileSync(pkgPath, 'utf8').replace('"version": "0.0.0"', '"version": "0.1.0"'));
      writeFileSync(join(sb.dir, 'packs/basic/CHANGELOG.md'), '# @fluxion/pack-basic\n\n## 0.1.0\n\n### Minor Changes\n\n- first release\n');
      const bumped = sb.run();
      assert.notEqual(bumped.status, 0, out(bumped));
      assert.match(bumped.stdout + bumped.stderr, /pack version 0\.0\.0 differs from package version 0\.1\.0/);
      const synced = sb.sync();
      assert.equal(synced.status, 0, out(synced));
      assert.match(readFileSync(join(sb.dir, 'packs/basic/src/index.ts'), 'utf8'), /export const VERSION: string = '0\.1\.0';/);
      const ledger = join(sb.dir, 'packs/basic/pack-versions.json');
      assert.deepEqual(Object.keys(JSON.parse(readFileSync(ledger, 'utf8'))), ['0.1.0']);
      assert.equal(sb.run().status, 0);
      // geometry whose hashes differ from those recorded for the released version fails until the version changes
      writeFileSync(ledger, readFileSync(ledger, 'utf8').replace(/"basic": "[0-9a-f]+"/, `"basic": "${'0'.repeat(64)}"`));
      const changed = sb.run();
      assert.notEqual(changed.status, 0, out(changed));
      assert.match(changed.stdout + changed.stderr, /release the change as a new pack version/);
      writeFileSync(ledger, '{}\n');
      const removed = sb.run();
      assert.notEqual(removed.status, 0, out(removed));
      assert.match(removed.stdout + removed.stderr, /no entry for the released version 0\.1\.0/);
    } finally {
      sb.cleanup();
    }
  });
});
