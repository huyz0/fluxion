#!/usr/bin/env node
// After `changeset version` (FR-LIB-007, ADR-0194, M18.110): give every declarative shape pack the version its package.json
// now has, then rebuild its pack/, goldens and ledger with the explicit write run. Without this a version bump leaves each
// pack's exported VERSION, index.json and ledger behind its package and every pack test fails.
// Usage: node scripts/packs/sync-versions.mjs [packs/<name> ...]   (default: every pack with a pack-versions.json)
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const VERSION = /export const VERSION: string = '[^']*';/;
const packs =
  process.argv.length > 2
    ? process.argv.slice(2)
    : readdirSync(join(ROOT, 'packs'))
        .map((d) => `packs/${d}`)
        .filter((p) => existsSync(join(ROOT, p, 'pack-versions.json')));

let failed = false;
for (const pack of packs) {
  const { version } = JSON.parse(readFileSync(join(ROOT, pack, 'package.json'), 'utf8'));
  const index = join(ROOT, pack, 'src/index.ts');
  const text = readFileSync(index, 'utf8');
  if (!VERSION.test(text)) {
    console.error(`${pack}: src/index.ts has no \`export const VERSION: string = '…';\``);
    failed = true;
    continue;
  }
  writeFileSync(index, text.replace(VERSION, `export const VERSION: string = '${version}';`));
  const env = { ...process.env, VITE_FLUXION_WRITE_PACK: '1' };
  const vitest = join(ROOT, 'node_modules/vitest/vitest.mjs');
  const write = spawnSync(process.execPath, [vitest, 'run', '-u', '--project', 'node', `${pack}/src/pack.test.ts`], { cwd: ROOT, env, stdio: 'inherit' });
  delete env.VITE_FLUXION_WRITE_PACK;
  const check = write.status === 0 && spawnSync(process.execPath, [vitest, 'run', '--project', 'node', pack], { cwd: ROOT, env, stdio: 'inherit' });
  const ok = check !== false && check.status === 0;
  if (!ok) failed = true;
  console.log(`${pack}: ${version}${ok ? '' : ' FAILED'}`);
}
process.exitCode = failed ? 1 : 0;
