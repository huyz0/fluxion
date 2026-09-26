#!/usr/bin/env node
// One-time (idempotent) developer/agent setup. Run as `pnpm run setup` (`pnpm setup` is a pnpm built-in; ADR-0138).
import { chmodSync } from 'node:fs';
import { git, node, repoPath } from '../gates/lib.mjs';

const steps = [
  ['git hooks', () => git(['config', 'core.hooksPath', '.githooks'])],
  ['skill adapters', () => node('scripts/harness/sync-skills.mjs')],
  // POSIX git ignores hooks without the executable bit (the tracked mode is 100755 too)
  ['hook permissions', () => { for (const h of ['pre-commit', 'commit-msg']) chmodSync(repoPath('.githooks', h), 0o755); return { status: 0, stdout: '', stderr: '' }; }],
];
let ok = true;
for (const [name, fn] of steps) {
  const r = fn();
  console.log(`${r.status === 0 ? 'ok  ' : 'FAIL'} ${name}${r.stdout.trim() ? `\n${r.stdout.trim()}` : ''}`);
  if (r.status !== 0) { ok = false; console.error(r.stderr); }
}
const [major] = process.versions.node.split('.').map(Number);
if (major < 22) { ok = false; console.error(`Node ${process.versions.node} < 22 (NFR-PORT-004)`); }
process.exit(ok ? 0 : 1);
