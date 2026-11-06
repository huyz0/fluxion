#!/usr/bin/env node
// Package hygiene for every publishable library (NFR-MNT-001, NFR-MNT-007).
//   check-packages.mjs --tool publint   exports/files/metadata lint on the packed package (strict)
//   check-packages.mjs --tool attw      "are the types wrong" on the packed package (ESM-only profile)
//   check-packages.mjs --tool … --dir <workspace>   one workspace (tests)
//   check-packages.mjs --tool … --dirs a,b          the named libraries only (the staged ladder: those whose packing the commit can change)
//   check-packages.mjs --pack-to <dir> [--dir|--dirs]  pack the libraries into <dir> and check nothing
//   check-packages.mjs --tool … --tarballs <dir>    check the tarballs a --pack-to run wrote instead of packing again
// Each library is packed once with `pnpm pack` (the packer publint's own CLI picks here); both tools read that tarball, so the
// ladder's publint and attw steps share one packing of every library (M18.157 attempt 4). Without --tarballs a run packs into a
// temporary folder it removes. Libraries come from tools/gen/workspaces.json (packages/* and packs/*); run after a build.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { quoteWin, REPO_ROOT } from './lib.mjs';

const argv = process.argv.slice(2);
const opt = (k) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const tool = opt('tool');
const packTo = opt('pack-to');
if (packTo === undefined && !['publint', 'attw'].includes(tool)) {
  console.error('usage: check-packages.mjs --tool publint|attw [--dir <workspace> | --dirs a,b] [--tarballs <dir>] | --pack-to <dir>');
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
const env = { ...process.env, NO_COLOR: '1' };

/** `spawnSync` with Windows' shell for a .cmd shim, as one quoted command line. */
function spawn(cmd, args, cwd) {
  return process.platform === 'win32'
    ? spawnSync([cmd, ...args].map(quoteWin).join(' '), { cwd, encoding: 'utf8', shell: true, env })
    : spawnSync(cmd, args, { cwd, encoding: 'utf8', env });
}
const tail = (r) => `${r.stdout ?? ''}\n${r.stderr ?? r.error?.message ?? ''}`.trim().split(/\r?\n/).slice(-15).join('\n');
/** One folder per library, so a tarball's name (from the manifest) never decides which library it is. */
const slot = (root, dir) => join(root, dir.replace(/[\\/]/g, '__'));

/** Packs every library into its slot under `root`; the failures, by library. */
function packAll(root) {
  const failures = [];
  for (const dir of dirs) {
    const out = slot(root, dir);
    mkdirSync(out, { recursive: true });
    const r = spawn('pnpm', ['pack', '--pack-destination', out], join(REPO_ROOT, dir));
    if (r.status !== 0) failures.push(`${dir}:\n${tail(r)}`);
  }
  return failures;
}

if (packTo !== undefined) {
  const failures = packAll(packTo);
  for (const f of failures) console.error(`pack ${f}`);
  if (failures.length) process.exit(1);
  console.log(`pack: ${dirs.length} package(s) packed`);
  process.exit(0);
}

/** The one tarball in a library's slot. */
function tarball(root, dir) {
  const files = readdirSync(slot(root, dir)).filter((f) => f.endsWith('.tgz'));
  if (files.length !== 1) throw new Error(`expected one tarball for ${dir}, found ${files.length}`);
  return join(slot(root, dir), files[0]);
}

const attwBin = join(toolsRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'attw.cmd' : 'attw');
const attw = (file) => {
  const r = spawn(attwBin, [file, '--profile', 'esm-only', '--format', 'ascii'], REPO_ROOT);
  return r.status === 0 ? undefined : tail(r);
};
// publint's API on the tarball: what `publint --strict` reports, without packing again (errors fail; warnings are errors under strict)
const require = createRequire(join(toolsRoot, 'package.json'));
const lint = tool === 'publint' ? await import(pathToFileURL(require.resolve('publint')).href) : undefined;
const utils = tool === 'publint' ? await import(pathToFileURL(require.resolve('publint/utils')).href) : undefined;
async function publint(file) {
  const bytes = readFileSync(file);
  const { messages, pkg } = await lint.publint({ pack: { tarball: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }, strict: true });
  const errors = messages.filter((m) => m.type === 'error');
  return errors.length === 0 ? undefined : errors.map((m, i) => `${i + 1}. ${utils.formatMessage(m, pkg)}`).join('\n');
}

const given = opt('tarballs');
const root = given ?? mkdtempSync(join(tmpdir(), 'fluxion-pack-'));
const failures = [];
try {
  const packing = given === undefined ? packAll(root) : [];
  failures.push(...packing.map((f) => `(pack) ${f}`));
  for (const dir of dirs) {
    if (packing.some((f) => f.startsWith(`${dir}:`))) continue;
    let problem;
    try {
      const file = tarball(root, dir);
      problem = tool === 'publint' ? await publint(file) : attw(file);
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
    if (problem !== undefined) failures.push(`${dir}:\n${problem}`);
  }
} finally {
  if (given === undefined) rmSync(root, { recursive: true, force: true });
}
if (failures.length) {
  for (const f of failures) console.error(`${tool} ${f}`);
  process.exit(1);
}
console.log(`${tool}: ${dirs.length} package(s) ok`);
