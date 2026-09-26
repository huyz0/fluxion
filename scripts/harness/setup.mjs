#!/usr/bin/env node
// One-time (idempotent) developer/agent setup. Run as `pnpm run setup` (`pnpm setup` is a pnpm built-in; ADR-0138).
import { chmodSync } from 'node:fs';
import { exists, git, node, repoPath, run } from '../gates/lib.mjs';

const steps = [
  ['git hooks', () => git(['config', 'core.hooksPath', '.githooks'])],
  ['skill adapters', () => node('scripts/harness/sync-skills.mjs')],
  // POSIX git ignores hooks without the executable bit (the tracked mode is 100755 too)
  [
    'hook permissions',
    () => {
      for (const h of ['pre-commit', 'commit-msg']) chmodSync(repoPath('.githooks', h), 0o755);
      return { status: 0, stdout: '', stderr: '' };
    },
  ],
  // the Vitest browser project (T1) runs in Playwright's Chromium; pre-commit needs it (M1.12 review F2)
  [
    'chromium for browser tests',
    () => {
      const cli = repoPath('node_modules', 'playwright', 'cli.js');
      if (!exists('node_modules/playwright/cli.js')) return { status: 1, stdout: '', stderr: 'playwright is not installed: run `pnpm install` first' };
      return run(process.execPath, [cli, 'install', 'chromium']);
    },
  ],
];
let ok = true;
for (const [name, fn] of steps) {
  const r = fn();
  console.log(`${r.status === 0 ? 'ok  ' : 'FAIL'} ${name}${r.stdout.trim() ? `\n${r.stdout.trim()}` : ''}`);
  if (r.status !== 0) {
    ok = false;
    console.error(r.stderr);
  }
}
const [major] = process.versions.node.split('.').map(Number);
if (major < 22) {
  ok = false;
  console.error(`Node ${process.versions.node} < 22 (NFR-PORT-004)`);
}
process.exit(ok ? 0 : 1);
