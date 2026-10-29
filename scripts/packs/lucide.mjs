#!/usr/bin/env node
// Regenerate the icons-lucide pack's definitions (FR-LIB-007, M18.29) from the pinned Lucide Iconify collection: the curated
// subset in packs/icons-lucide/subset.json, converted through the same Iconify importer and Node paint witness a host uses
// (M18.18, M18.101), written to packs/icons-lucide/src/icons.json with each icon's library category. Run after changing the
// subset or the pinned collection, then rebuild pack/ and the goldens with the pack's write run.
// Usage: node scripts/packs/lucide.mjs   (after pnpm run build)
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const PACK = join(ROOT, 'packs/icons-lucide');
const { importIconifyCollection } = await import(pathToFileURL(join(ROOT, 'packages/format/dist/index.js')).href);
const { createNodeSvgPaintWitness } = await import(pathToFileURL(join(ROOT, 'packages/cli/dist/svg-witness.js')).href);

const source = readFileSync(join(ROOT, 'specs/import/corpus/iconify/lucide.json'), 'utf8');
// provenance names the pinned collection file itself, not the per-chunk subsets handed to the importer
const sourceSha256 = createHash('sha256').update(source).digest('hex');
/** @type {Record<string, string[]>} category → icon names, in library order */
const subset = JSON.parse(readFileSync(join(PACK, 'subset.json'), 'utf8'));
const wanted = Object.entries(subset).flatMap(([category, names]) => names.map((name) => ({ name, category })));
const collection = JSON.parse(source);
const missing = wanted.filter(({ name }) => !Object.hasOwn(collection.icons, name));
if (missing.length) throw new Error(`not icons of the pinned collection (aliases are not accepted): ${missing.map((m) => m.name).join(', ')}`);

// a witness session renders at most 128 requests, so the subset is converted in chunks, each with its own session
const CHUNK = 100;
const entries = [];
for (let i = 0; i < wanted.length; i += CHUNK) {
  const session = await createNodeSvgPaintWitness({ theme: { name: 'plain', tokens: {} }, fonts: [] });
  if (!session.ok) throw new Error(`no paint witness: ${JSON.stringify(session.error)}`);
  try {
    // only the subset is converted: the rest of the collection is left out of the request entirely
    const icons = Object.fromEntries(wanted.slice(i, i + CHUNK).map(({ name }) => [name, collection.icons[name]]));
    const report = await importIconifyCollection(JSON.stringify({ ...collection, icons, aliases: {} }), { witness: session.value.witness });
    if (report.status !== 'processed') throw new Error(`import failed: ${JSON.stringify(report.diagnostics)}`);
    entries.push(...report.entries);
  } finally {
    await session.value.dispose();
  }
}
const byName = new Map(entries.map((e) => [e.name, e]));
const out = wanted.map(({ name, category }) => {
  const entry = byName.get(name);
  if (entry?.status !== 'accepted') throw new Error(`${name} was refused: ${JSON.stringify(entry?.diagnostics)}`);
  if (entry.value.fonts.length) throw new Error(`${name} needs fonts, which a 1.0 pack cannot carry`);
  return { name, category, definition: entry.value.definition };
});
// The upstream notice credits Lucide (ISC) and, for the icons it lists, Feather (MIT); those listed names are resolved through
// the collection's aliases (Feather names were renamed since) to the subset icons they now are.
const notice = readFileSync(join(ROOT, 'specs/import/corpus/licenses/lucide.txt'), 'utf8');
const [lucideNotice, featherNotice] = notice.split(/\n---\n/).map((part) => part.trim());
const listed = featherNotice?.match(/derived from the Feather project:\n\n([^\n]+)/)?.[1];
if (!listed) throw new Error('the Lucide notice no longer lists its Feather-derived icons');
const canonical = (name) => {
  for (let seen = 0; Object.hasOwn(collection.aliases ?? {}, name) && seen < 16; seen++) name = collection.aliases[name].parent;
  return name;
};
const derived = new Set(listed.split(',').map((name) => canonical(name.trim())));
const feather = out.filter(({ name }) => derived.has(name)).map(({ name }) => name);
const json = { sourceSha256, notices: { lucide: lucideNotice, feather: featherNotice }, feather, icons: out };
writeFileSync(join(PACK, 'src/icons.json'), `${JSON.stringify(json, null, 2)}\n`);
console.log(`icons-lucide: ${out.length} icons (${feather.length} Feather-derived) from collection ${sourceSha256.slice(0, 12)}`);
