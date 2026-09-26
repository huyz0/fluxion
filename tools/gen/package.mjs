#!/usr/bin/env node
// Workspace generator (NFR-MNT-001).
//   node tools/gen/package.mjs --all        create missing files for every workspace in workspaces.json
//   node tools/gen/package.mjs <dir>         create missing files for one workspace
//   node tools/gen/package.mjs --check      exit 1 if a workspace file or root tsconfig reference is missing
// Files are created only when absent (packages evolve after generation); the root tsconfig.json
// references are always rewritten from the manifest so `tsc -b` covers every workspace.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { workspaces } = JSON.parse(readFileSync(join(ROOT, 'tools', 'gen', 'workspaces.json'), 'utf8'));
const YEAR = 2026;

const LICENSE = `MIT License

Copyright (c) ${YEAR} Fluxion contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

// libraries (packages/*, packs/*) build with tsdown; apps get their own build in later rows
const isLibrary = (w) => w.dir.startsWith('packages/') || w.dir.startsWith('packs/');
const TSDOWN =
  "import { defineConfig } from 'tsdown';\n\nexport default defineConfig({\n  entry: ['src/index.ts'],\n  format: 'esm',\n  dts: true,\n  clean: true,\n  sourcemap: true,\n  fixedExtension: false, // emit index.js + index.d.ts to match the exports map (type: module)\n});\n";

const rules = (w) => {
  if (w.runtime === 'pure')
    return '- **Pure package**: no DOM, timers, `Date.now`, `Math.random`, network or `node:*`. Inject ports (`Clock`, `Random`, `TextMeasurer`, `FileIO`).';
  if (w.layer === 'Pack') return '- Import only `@fluxion/sdk` (and allowed peer libraries). No private back doors into other packages.';
  if (w.runtime === 'dom') return '- DOM allowed. Business logic belongs in the pure packages below this layer.';
  if (w.runtime === 'node') return '- Node runtime (>= 22). Keep command logic in shared `ops` so the MCP server and CLI stay identical.';
  return '- Follow the layer rules in docs/architecture/01-overview.md.';
};

// Per-runtime type environment (M1 cp1 F5): pure packages state ES-only explicitly, so adding DOM to
// the base config for an app can never leak DOM types into them.
const RUNTIME = {
  pure: { lib: ['ES2023'], types: [] },
  dom: { lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: [] },
  node: { lib: ['ES2023'], types: ['node'] },
  mixed: { lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: ['node'] },
};
const dirOf = (name) => workspaces.find((w) => w.dir.endsWith(`/${name}`)).dir;
// fields the generator owns in every workspace tsconfig; the rest may evolve by hand
const tsconfigOwned = (w) => ({
  lib: RUNTIME[w.runtime].lib,
  types: RUNTIME[w.runtime].types,
  references: w.dependsOn.map((d) => ({ path: `../../${dirOf(d)}` })),
});

const files = (w) => ({
  'package.json': `${JSON.stringify(
    {
      name: w.name,
      version: '0.0.0',
      description: w.desc,
      license: 'MIT',
      ...(w.private ? { private: true } : {}),
      type: 'module',
      sideEffects: false,
      exports: { '.': { '@fluxion/source': './src/index.ts', types: './dist/index.d.ts', default: './dist/index.js' } },
      files: ['dist'],
      ...(isLibrary(w) ? { scripts: { build: 'tsdown', typecheck: 'tsc -b' } } : {}),
    },
    null,
    2,
  )}\n`,
  ...(isLibrary(w) ? { 'tsdown.config.ts': TSDOWN } : {}),
  'tsconfig.json': `${JSON.stringify(
    {
      extends: '../../tsconfig.base.json',
      compilerOptions: {
        rootDir: 'src',
        outDir: '.tsbuild',
        emitDeclarationOnly: true,
        tsBuildInfoFile: '.tsbuild/tsconfig.tsbuildinfo',
        lib: tsconfigOwned(w).lib,
        types: tsconfigOwned(w).types,
      },
      include: ['src'],
      references: tsconfigOwned(w).references,
    },
    null,
    2,
  )}\n`,
  // the package name in backticks: a bare `@fluxion/x` at the start reads as a malformed TSDoc tag
  'src/index.ts': `/**\n * \`${w.name}\` — ${w.desc}\n *\n * @packageDocumentation\n */\n\n/**\n * Version of this package.\n *\n * @public\n */\nexport const VERSION: string = '0.0.0';\n`,
  // T0 smoke test (NFR-MNT-004): keeps the stub above its coverage floor and proves the node project runs it
  'src/index.test.ts': `import { expect, it } from 'vitest';\nimport { VERSION } from './index.js';\n\nit('NFR-MNT-004 smoke: ${w.name} exports its version', () => {\n  expect(VERSION).toBe('0.0.0');\n});\n`,
  'README.md': `# ${w.name}\n\n${w.desc}\n\n| Layer | Pure | Status |\n|---|---|---|\n| ${w.layer} | ${w.runtime === 'pure' ? 'yes' : 'no'} | stub (M1) — exports \`VERSION\` only |\n\nArchitecture: [docs/architecture/01-overview.md](../../docs/architecture/01-overview.md).\n`,
  'AGENTS.md': `# ${w.name} — agent notes\n\n${w.desc}\n\n## Rules\n\n- Layer ${w.layer}: import only from lower layers, or same-layer packages the map lists as dependencies (docs/architecture/01-overview.md, "May depend on"); enforced by \`check-layering\`.\n${rules(w)}\n- Public API lives in \`src/index.ts\` (\`@fluxion/source\` condition; ADR-0011); every export needs TSDoc and a release tag.\n\n## Tests\n\n- Co-locate \`*.test.ts\` next to the code; name tests with requirement IDs.\n- ${w.runtime === 'pure' ? 'T0 (node) only — no DOM in tests.' : 'T0 for logic, T1 (browser) for components.'}\n`,
  LICENSE,
});

function generate(w) {
  const created = [];
  for (const [rel, text] of Object.entries(files(w))) {
    const path = join(ROOT, w.dir, rel);
    if (existsSync(path)) continue;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    created.push(`${w.dir}/${rel}`);
  }
  return created;
}

function syncReferences(write) {
  const path = join(ROOT, 'tsconfig.json');
  const cfg = JSON.parse(readFileSync(path, 'utf8'));
  const want = workspaces.map((w) => ({ path: `./${w.dir}` }));
  const same = JSON.stringify(cfg.references) === JSON.stringify(want);
  if (!same && write) writeFileSync(path, `${JSON.stringify({ ...cfg, references: want }, null, 2)}\n`);
  return same;
}

/** Rewrite (or, without write, report) workspace tsconfigs whose owned fields drifted from the manifest. */
function syncTsconfigs(write) {
  const stale = [];
  for (const w of workspaces) {
    const path = join(ROOT, w.dir, 'tsconfig.json');
    if (!existsSync(path)) continue;
    const cfg = JSON.parse(readFileSync(path, 'utf8'));
    const want = tsconfigOwned(w);
    const have = { lib: cfg.compilerOptions?.lib, types: cfg.compilerOptions?.types, references: cfg.references };
    if (JSON.stringify(have) === JSON.stringify(want)) continue;
    stale.push(`${w.dir}/tsconfig.json`);
    if (write) {
      const next = { ...cfg, compilerOptions: { ...cfg.compilerOptions, lib: want.lib, types: want.types }, references: want.references };
      writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
    }
  }
  return stale;
}

// Written files go through the repo formatter so a fresh workspace passes `biome ci` (M1.9 review F1).
function format(paths) {
  // FLUXION_TOOLS_ROOT lets tests generate into a sandbox with this repo's installed formatter
  const biome = join(process.env.FLUXION_TOOLS_ROOT ?? ROOT, 'node_modules', '@biomejs', 'biome', 'bin', 'biome');
  if (paths.length === 0 || !existsSync(biome)) return;
  const r = spawnSync(process.execPath, [biome, 'format', '--write', '--no-errors-on-unmatched', ...paths], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`gen: biome format failed\n${r.stdout}${r.stderr}`);
    process.exit(1);
  }
}

const arg = process.argv[2];
if (arg === '--check') {
  const missing = workspaces.flatMap((w) =>
    Object.keys(files(w))
      .filter((f) => !existsSync(join(ROOT, w.dir, f)))
      .map((f) => `${w.dir}/${f}`),
  );
  if (!syncReferences(false)) missing.push('tsconfig.json references out of sync (run node tools/gen/package.mjs --all)');
  for (const s of syncTsconfigs(false)) missing.push(`${s} lib/types/references out of sync with workspaces.json (run node tools/gen/package.mjs --all)`);
  for (const m of missing) console.error(`gen: missing ${m}`);
  process.exit(missing.length ? 1 : 0);
}
const targets = arg === '--all' ? workspaces : workspaces.filter((w) => w.dir === arg);
if (targets.length === 0) {
  console.error('usage: package.mjs --all | --check | <dir listed in tools/gen/workspaces.json>');
  process.exit(2);
}
const created = targets.flatMap(generate);
const synced = syncReferences(true);
const retyped = syncTsconfigs(true);
format([...new Set([...created.filter((p) => /\.(json|ts)$/.test(p)), ...retyped, ...(synced ? [] : ['tsconfig.json'])])]);
console.log(`gen: created ${created.length} files; tsconfig references synced (${workspaces.length})`);
