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
  const run = () => {
    const env = { ...process.env, FLUXION_VITEST_CACHE: join(dir, '.vitest-cache') };
    for (const key of ['CI', 'VITE_FLUXION_WRITE_PACK']) delete env[key];
    return spawnSync(process.execPath, [join(REPO, 'node_modules/vitest/vitest.mjs'), 'run', '--project', 'node', SUITE], { cwd: dir, encoding: 'utf8', env });
  };
  return { dir, run, cleanup: () => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) };
}

describe('pack golden legs (M18.100, M18.102, FR-LIB-007, HARNESS)', () => {
  it('a deleted golden fails the pack suite outside CI and is not written back; an orphan golden and a changed recorded version fail too', () => {
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
      rmSync(join(sb.dir, 'packs/basic/__golden__/orphan.svg'));
      // geometry whose hashes differ from those recorded for the current version fails until the version changes
      const ledger = join(sb.dir, 'packs/basic/pack-versions.json');
      writeFileSync(ledger, readFileSync(ledger, 'utf8').replace(/"basic": "[0-9a-f]+"/, `"basic": "${'0'.repeat(64)}"`));
      const changed = sb.run();
      assert.notEqual(changed.status, 0, out(changed));
      assert.match(changed.stdout + changed.stderr, /release the change as a new pack version/);
    } finally {
      sb.cleanup();
    }
  });
});
