#!/usr/bin/env node
// The harness suite must leave the working tree untouched (M1.36, M1 cp3 F1): with the concurrent
// ladder (M1.28) any test that writes the repo races the steps reading it.
//   check-suite-isolation.mjs                  run `node --test tests/harness/*.test.mjs` on the repo
//   check-suite-isolation.mjs --dir <root> --cmd <script.mjs>   tests: run a script in <root> instead
// Fails if the run fails or if any file (tracked, untracked or ignored; not .git or node_modules)
// was created, deleted or rewritten.
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { REPO_ROOT } from './lib.mjs';

const argv = process.argv.slice(2);
const opt = (k) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const root = opt('dir') ? resolve(opt('dir')) : REPO_ROOT;
const SKIP = new Set(['.git', 'node_modules']);

/** path -> "size:mtime" for every file under root. */
export function snapshot(dir, out = new Map()) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) snapshot(p, out);
    else if (e.isFile()) {
      const s = statSync(p);
      out.set(relative(root, p).split(sep).join('/'), `${s.size}:${s.mtimeMs}`);
    }
  }
  return out;
}

export function changes(before, after) {
  const out = [];
  for (const [p, v] of after) {
    if (!before.has(p)) out.push(`created ${p}`);
    else if (before.get(p) !== v) out.push(`rewrote ${p}`);
  }
  for (const p of before.keys()) if (!after.has(p)) out.push(`deleted ${p}`);
  return out.sort();
}

const before = snapshot(root);
const cmd = opt('cmd') ? [resolve(opt('cmd'))] : ['--test', 'tests/harness/*.test.mjs'];
const r = spawnSync(process.execPath, cmd, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const diff = changes(before, snapshot(root));
if (r.status !== 0) console.error(`isolation: the suite failed (exit ${r.status})\n${`${r.stdout}\n${r.stderr}`.trim().split(/\r?\n/).slice(-30).join('\n')}`);
for (const d of diff.slice(0, 30)) console.error(`isolation: the suite ${d}`);
if (diff.length > 30) console.error(`isolation: … and ${diff.length - 30} more`);
if (r.status !== 0 || diff.length) process.exit(1);
console.log(`isolation: the suite passed and left ${before.size} files untouched`);
