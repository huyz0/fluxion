#!/usr/bin/env node
// One-time (idempotent) developer/agent setup. Wrapped by `pnpm setup` from M1.
import { git, node } from '../gates/lib.mjs';

const steps = [
  ['git hooks', () => git(['config', 'core.hooksPath', '.githooks'])],
  ['skill adapters', () => node('scripts/harness/sync-skills.mjs')],
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
