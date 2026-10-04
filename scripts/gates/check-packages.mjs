#!/usr/bin/env node
// Package hygiene for every publishable library (NFR-MNT-001, NFR-MNT-007).
//   check-packages.mjs --tool publint   exports/files/metadata lint on the packed package
//   check-packages.mjs --tool attw      "are the types wrong" (ESM-only profile)
//   check-packages.mjs --tool … --dir <workspace>   one workspace (tests)
//   check-packages.mjs --tool … --dirs a,b          the named libraries only (the staged ladder: those whose packing the commit can change)
// Libraries come from tools/gen/workspaces.json (packages/* and packs/*); run after a build.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { quoteWin, REPO_ROOT } from './lib.mjs';

const argv = process.argv.slice(2);
const opt = (k) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const tool = opt('tool');
if (!['publint', 'attw'].includes(tool)) {
  console.error('usage: check-packages.mjs --tool publint|attw [--dir <workspace>]');
  process.exit(2);
}

const { workspaces } = JSON.parse(readFileSync(join(REPO_ROOT, 'tools/gen/workspaces.json'), 'utf8'));
const dirs = opt('dir')
  ? [opt('dir')]
  : opt('dirs')
    ? opt('dirs').split(',')
    : workspaces.filter((w) => !w.private && (w.dir.startsWith('packages/') || w.dir.startsWith('packs/'))).map((w) => w.dir);
// FLUXION_TOOLS_ROOT lets tests lint a sandbox checkout with this repo's installed tools
const toolsRoot = process.env.FLUXION_TOOLS_ROOT ?? REPO_ROOT;
const bin = join(toolsRoot, 'node_modules', '.bin', process.platform === 'win32' ? `${tool}.cmd` : tool);
const args = tool === 'publint' ? ['--strict'] : ['--pack', '.', '--profile', 'esm-only', '--format', 'ascii'];

const failures = [];
for (const dir of dirs) {
  const cwd = join(REPO_ROOT, dir);
  const r =
    process.platform === 'win32'
      ? spawnSync([bin, ...args].map(quoteWin).join(' '), { cwd, encoding: 'utf8', shell: true, env: { ...process.env, NO_COLOR: '1' } })
      : spawnSync(bin, args, { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  if (r.status !== 0) failures.push(`${dir}:\n${`${r.stdout}\n${r.stderr}`.trim().split(/\r?\n/).slice(-15).join('\n')}`);
}
if (failures.length) {
  for (const f of failures) console.error(`${tool} ${f}`);
  process.exit(1);
}
console.log(`${tool}: ${dirs.length} package(s) ok`);
