#!/usr/bin/env node
// Layering gate (NFR-MNT-001): docs/architecture/01-overview.md §2 dependency rules.
//   check-layering.mjs [--dir <root>]      (all modes check everything; --dir lints a sandbox)
// 1. tools/gen/workspaces.json dependsOn must equal the overview map's "May depend on" column and
//    point only at lower layers (or the same layer, when listed).
// 2. dependency-cruiser (.dependency-cruiser.mjs, built from dependsOn) over every workspace.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { quoteWin, REPO_ROOT } from './lib.mjs';

const argv = process.argv.slice(2);
const dirArg = argv.indexOf('--dir');
const root = dirArg >= 0 ? resolve(argv[dirArg + 1]) : REPO_ROOT;
// FLUXION_TOOLS_ROOT lets tests lint a sandbox checkout with this repo's installed tools
const toolsRoot = process.env.FLUXION_TOOLS_ROOT ?? REPO_ROOT;
const errors = [];

const { workspaces } = JSON.parse(readFileSync(join(root, 'tools/gen/workspaces.json'), 'utf8'));
const short = (w) => w.dir.split('/').at(-1);
const byShort = new Map(workspaces.map((w) => [short(w), w]));
// packs sit at the host layer: a host may bundle a pack its map row names (ADR-0017)
const RANK = { L0: 0, L1: 1, L2: 2, L3: 3, L4: 4, L5: 5, App: 6, Pack: 5 };

// the overview's package table: | Layer | `pkg` | responsibility | may depend on | pure |
const mapped = new Map();
for (const row of readFileSync(join(root, 'docs/architecture/01-overview.md'), 'utf8').split(/\r?\n/)) {
  const cells = row.split('|').map((c) => c.trim());
  const pkg = /^`(?:apps\/)?([a-z-]+|packs\/\*)`/.exec(cells[2] ?? '')?.[1];
  if (!pkg) continue;
  const deps = [...byShort.keys()].filter((n) => new RegExp(`(^|[\\s,(])${n}($|[\\s,)])`).test(cells[4]));
  // one `packs/*` row covers every pack
  for (const name of pkg === 'packs/*' ? workspaces.filter((w) => w.layer === 'Pack').map(short) : [pkg]) mapped.set(name, deps);
}

for (const w of workspaces) {
  const name = short(w);
  const want = mapped.get(name);
  if (!want) errors.push(`workspaces.json: ${name} is not in the overview package map`);
  else if ([...w.dependsOn].sort().join() !== [...want].sort().join()) {
    errors.push(`workspaces.json: ${name} dependsOn [${w.dependsOn}] != overview "May depend on" [${want}]`);
  }
  for (const d of w.dependsOn) {
    const dep = byShort.get(d);
    if (!dep) errors.push(`workspaces.json: ${name} depends on unknown workspace ${d}`);
    else if (RANK[dep.layer] > RANK[w.layer]) errors.push(`workspaces.json: ${name} (${w.layer}) depends on higher layer ${d} (${dep.layer})`);
  }
}

const dirs = ['packages', 'packs', 'apps'].filter((d) => existsSync(join(root, d)));
const bin = join(toolsRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'depcruise.cmd' : 'depcruise');
const args = ['--config', '.dependency-cruiser.mjs', '--output-type', 'err', '--no-progress', ...dirs];
const r =
  process.platform === 'win32'
    ? spawnSync([bin, ...args].map(quoteWin).join(' '), { cwd: root, encoding: 'utf8', shell: true, env: { ...process.env, NO_COLOR: '1' } })
    : spawnSync(bin, args, { cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
if (r.status !== 0) errors.push(`dependency-cruiser:\n${`${r.stdout}\n${r.stderr}`.trim()}`);

if (errors.length) {
  for (const e of errors) console.error(`layering: ${e}`);
  process.exit(1);
}
console.log(`layering: ${workspaces.length} workspaces, dependsOn matches the overview, 0 dependency violations`);
