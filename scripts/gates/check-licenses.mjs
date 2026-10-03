#!/usr/bin/env node
// Licence gate (NFR-LIC-001, NFR-LIC-002; tech-stack.md §3 rules 1-3).
//   check-licenses.mjs                  the repo: `pnpm licenses list` + LICENSE/NOTICE files
//   check-licenses.mjs --dir <root> --json-dir <dir>
//                                       tests: listings read from <dir>/{prod,dev,pack-<name>}.json
// Shipped (production) dependencies must use an allowed licence; EPL/LGPL only in the named packs.
// Every dependency, dev tools of every workspace included, is checked against the deny list.
// Every workspace ships the MIT LICENSE and declares "license": "MIT"; the root has NOTICE.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { REPO_ROOT, run } from './lib.mjs';
import { parseSpdx, satisfiable } from './spdx.mjs';
import { FONT_LICENSES, LICENSES } from './thresholds.mjs';

const argv = process.argv.slice(2);
const opt = (k) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const root = opt('dir') ? resolve(opt('dir')) : REPO_ROOT;
const jsonDir = opt('json-dir');
const errors = [];

// tests put <key>.json (a listing) or <key>.fail (a failed pnpm run, its text) in --json-dir
function source(key, args) {
  if (!jsonDir) return run('pnpm', ['licenses', 'list', '--json', ...args], { cwd: root });
  const file = (ext) => join(jsonDir, `${key}.${ext}`);
  if (existsSync(file('fail'))) return { status: 1, stdout: readFileSync(file('fail'), 'utf8'), stderr: '' };
  return { status: 0, stdout: existsSync(file('json')) ? readFileSync(file('json'), 'utf8') : '{}', stderr: '' };
}

/**
 * `pnpm licenses list --json` → [{ name, version, license }]. Only pnpm's own "No licenses …"
 * message means none: a failed or unreadable run fails the gate instead of passing it empty
 * (M1.15 review F1).
 */
function listing(key, args) {
  const r = source(key, args);
  const text = r.stdout.trim();
  if (r.status === 0 && /^No licenses in packages found/.test(text)) return [];
  let json;
  try {
    json = r.status === 0 ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!json || typeof json !== 'object') {
    errors.push(`pnpm licenses list ${args.join(' ')} failed (exit ${r.status}): ${`${text}\n${r.stderr}`.trim().slice(0, 300)}`);
    return [];
  }
  return Object.entries(json).flatMap(([license, pkgs]) => pkgs.map((p) => ({ name: p.name, version: p.versions?.join(', ') ?? '', license })));
}

// SPDX expressions are parsed with precedence and grouping (spdx.mjs); a field that is not a valid
// expression is free text: never allowed in shipped code, and denied if it names a GPL-family licence
const tree = (expr) => {
  try {
    return parseSpdx(expr);
  } catch {
    return null;
  }
};
const allowedBy = (expr, allow) => {
  const t = tree(expr);
  return t !== null && satisfiable(t, (id) => allow.includes(id));
};
// an SPDX id, case-insensitive and loose about the version: GPL, GPLv3, gpl-3.0, GPL-3.0+ (not LGPL)
const DENY = new RegExp(`^(${LICENSES.denyPrefixes.map((d) => d.replace(/-$/, '')).join('|')})(?:$|[^A-Z]|V\\d)`, 'i');
// free text: "GNU GPLv3", "GNU General Public License v3", "Affero" (not Lesser/Library GPL)
const DENY_TEXT = new RegExp(
  `(?<!\\b(LESSER|LIBRARY)[\\s._/-]+)((?<![A-Z0-9])(${LICENSES.denyPrefixes.map((d) => d.replace(/-$/, '')).join('|')})|GENERAL PUBLIC LICENSE)|AFFERO`,
  'i',
);
// denied when every way of satisfying the expression uses a denied licence
const denied = (expr) => {
  const t = tree(expr);
  // an id may itself be free text in one token (GNU-GPL-3.0, GNU/GPLv3): test it both ways (M1.34)
  return t === null ? DENY_TEXT.test(expr) : !satisfiable(t, (id) => !DENY.test(id) && !DENY_TEXT.test(id));
};
const at = (p) => `${p.name}@${p.version} (${p.license})`;

function checkShipped(pkgs, allow, where) {
  for (const p of pkgs) if (!allowedBy(p.license, allow)) errors.push(`${where}: ${at(p)} is not an allowed licence for shipped code`);
}

const { workspaces } = JSON.parse(readFileSync(join(root, 'tools/gen/workspaces.json'), 'utf8'));
const packs = workspaces.filter((w) => w.dir.startsWith('packs/'));
const shippedCore = listing('prod', ['--prod', '--filter', './packages/**', '--filter', './apps/**']);
checkShipped(shippedCore, LICENSES.allow, 'packages/apps');
// -r: every workspace's devDependencies, not only the root's (M1.15 review F2)
const everything = [...shippedCore, ...listing('dev', ['--dev', '--recursive'])];
for (const w of packs) {
  const pkgs = listing(`pack-${w.dir.split('/')[1]}`, ['--prod', '--filter', `./${w.dir}`]);
  checkShipped(pkgs, [...LICENSES.allow, ...(LICENSES.packExceptions[w.dir] ?? [])], w.dir);
  everything.push(...pkgs);
}
for (const p of everything) {
  if (denied(p.license)) errors.push(`${at(p)}: licence is never allowed (GPL/AGPL/SSPL/BUSL)`);
  if (LICENSES.denyPackages.includes(p.name)) errors.push(`${at(p)}: watermark or licence-key library (tech-stack.md §3 rule 3)`);
}

// font files and the catalog (FR-THM-008, ADR-0022): every font of a pack's fonts.json and every family of its catalog.json is under
// the font allowlist; a manifest entry has a licence and a hash, and the file's bytes match it
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    errors.push(`${file.slice(root.length + 1)} is not readable JSON: ${e.message}`);
    return null;
  }
}
const fontOk = (where, license) => {
  if (typeof license !== 'string' || license === '') errors.push(`${where}: a font has no licence`);
  else if (!allowedBy(license, FONT_LICENSES.allow))
    errors.push(`${where}: font licence ${license} is not on the font allowlist (${FONT_LICENSES.allow.join(', ')})`);
};
// a manifest vouches only for files under its own pack
const inside = (dir, file) => {
  const rel = relative(dir, resolve(dir, file));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
};
for (const w of packs) {
  const manifest = join(root, w.dir, 'fonts.json');
  const catalog = join(root, w.dir, 'catalog.json');
  for (const f of existsSync(manifest) ? (readJson(manifest)?.fonts ?? []) : []) {
    const where = `${w.dir}/fonts.json ${f.file ?? '(no file)'}`;
    fontOk(where, f.license);
    if (typeof f.sha256 !== 'string' || f.sha256 === '') errors.push(`${where}: a font has no hash`);
    else if (!inside(join(root, w.dir), String(f.file))) errors.push(`${where}: the file is outside the pack`);
    else if (!existsSync(join(root, w.dir, String(f.file)))) errors.push(`${where}: the file is missing`);
    else if (
      createHash('sha256')
        .update(readFileSync(join(root, w.dir, String(f.file))))
        .digest('hex') !== f.sha256
    )
      errors.push(`${where}: the hash differs from the file`);
  }
  for (const f of existsSync(catalog) ? (readJson(catalog)?.families ?? []) : []) fontOk(`${w.dir}/catalog.json ${f.name ?? '(no name)'}`, f.license);
}

// our own licence files (NFR-LIC-001)
const mit = (file) => existsSync(file) && /^MIT License/m.test(readFileSync(file, 'utf8'));
if (!mit(join(root, 'LICENSE'))) errors.push('LICENSE at the repo root is missing or not MIT');
if (!existsSync(join(root, 'NOTICE'))) errors.push('NOTICE at the repo root is missing');
for (const w of workspaces) {
  if (!mit(join(root, w.dir, 'LICENSE'))) errors.push(`${w.dir}/LICENSE is missing or not MIT`);
  const license = JSON.parse(readFileSync(join(root, w.dir, 'package.json'), 'utf8')).license;
  if (license !== 'MIT') errors.push(`${w.dir}/package.json license is ${license ?? 'missing'}, not MIT`);
}

if (errors.length) {
  for (const e of errors) console.error(`licenses: ${e}`);
  process.exit(1);
}
console.log(`licenses: ${everything.length} dependencies checked; ${workspaces.length} workspaces MIT`);
