#!/usr/bin/env node
// Message extraction (ADR-0023; NFR-I18N-001): finds every Lingui message in the source of the packages that have UI with
// `@lingui/native-tools` (no Babel) and keeps the catalog `<package>/src/locales/en/messages.json` equal to it.
//   node scripts/i18n/extract.mjs           writes the catalogs
//   node scripts/i18n/extract.mjs --check   exits 1 when a catalog differs from the source (a new, changed or removed message)
// A catalog is one object keyed by message id, keys sorted: `{ "<id>": { "message": "<ICU>", "origin": ["<file>", ...] } }`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractMessagesFromFiles } from '@lingui/native-tools';
import { listFiles, repoPath } from '../gates/lib.mjs';

/** The packages that have UI strings: the source they are extracted from and where their English catalog lives. */
export const TARGETS = [
  { name: 'editor', src: 'packages/editor/src', catalog: 'packages/editor/src/locales/en/messages.json' },
  { name: 'studio', src: 'apps/studio/src', catalog: 'apps/studio/src/locales/en/messages.json' },
];

const SOURCE = /\.tsx?$/;
const NOT_SHIPPED = /\.(test|browser\.test|spec|stories|bench)\.tsx?$|\/__fixtures__\/|\/locales\/|\.d\.ts$/;

/** The files of `src` (repo-relative) a message can be extracted from: shipped sources only. */
export function sourceFiles(src) {
  return listFiles(src, (f) => SOURCE.test(f) && !NOT_SHIPPED.test(f)).sort();
}

/** Add one file's messages to `byId`; returns the problems (a warning, or one id with two texts). */
function collect(byId, file, result) {
  const problems = (result.warnings ?? []).map((w) => `${file}: ${w}`);
  for (const m of result.messages ?? []) {
    const entry = byId.get(m.id) ?? { message: m.message, origins: new Set() };
    if (entry.message !== m.message) problems.push(`${file}: message id ${m.id} has two texts ("${entry.message}" and "${m.message}")`);
    entry.origins.add(file);
    byId.set(m.id, entry);
  }
  return problems;
}

/**
 * The catalog the given files say, as the object `messages.json` holds (keys sorted).
 *
 * @param {string[]} files repo-relative source files
 * @param {{ read?: (path: string) => Promise<unknown> }} [deps]
 */
export async function extractCatalog(files, deps = {}) {
  const extract = deps.read ?? ((p) => extractMessagesFromFiles([repoPath(p)]));
  const byId = new Map();
  const errors = [];
  for (const file of files) errors.push(...collect(byId, file, await extract(file)));
  const catalog = {};
  for (const id of [...byId.keys()].sort()) catalog[id] = { message: byId.get(id).message, origin: [...byId.get(id).origins].sort() };
  return { catalog, errors };
}

/** A catalog as the text the file holds. */
export const renderCatalog = (catalog) => `${JSON.stringify(catalog, null, 2)}\n`;

/** The ids that differ between the catalog on disk and the one the source says, as `+ id`, `- id`, `~ id` lines. */
export function catalogDiff(onDisk, fromSource) {
  const lines = [];
  for (const id of Object.keys(fromSource)) {
    if (!(id in onDisk)) lines.push(`+ ${id}  ${fromSource[id].message}`);
    else if (JSON.stringify(onDisk[id]) !== JSON.stringify(fromSource[id])) lines.push(`~ ${id}  ${fromSource[id].message}`);
  }
  for (const id of Object.keys(onDisk)) if (!(id in fromSource)) lines.push(`- ${id}  ${onDisk[id].message}`);
  return lines;
}

/** Check or write one target's catalog; returns the number of problems. */
async function processTarget(target, check) {
  const { catalog, errors } = await extractCatalog(sourceFiles(target.src));
  for (const e of errors) console.error(`i18n: ${e}`);
  const path = repoPath(target.catalog);
  const text = renderCatalog(catalog);
  const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
  if (current === text) return errors.length;
  if (!check) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    console.log(`i18n: wrote ${target.catalog} (${Object.keys(catalog).length} messages)`);
    return errors.length;
  }
  console.error(`i18n: ${target.catalog} is out of date with the source (run pnpm i18n:extract):`);
  for (const line of catalogDiff(current === '' ? {} : JSON.parse(current), catalog)) console.error(`  ${line}`);
  return errors.length + 1;
}

async function main(argv) {
  const check = argv.includes('--check');
  let bad = 0;
  for (const target of TARGETS) bad += await processTarget(target, check);
  if (check && bad === 0) console.log('i18n: the catalogs match the source');
  return bad === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main(process.argv.slice(2)));
