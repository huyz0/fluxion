#!/usr/bin/env node
// The golden `.flux` files of container version 1.0 (NFR-PORT-003, M10.8): packages/format/__fixtures__/v1.0/*.flux.b64, base64 text of the
// archive so any tool can read them. Built here from the shared document fixtures with the shipped writer, never by hand.
//   goldens.mjs           write every golden
//   goldens.mjs --check   exit 1 when a golden is missing or differs from what the writer produces now
// A golden that changes is a change of the file format: it needs an ADR and a migration note (non-negotiable 6). Reads the built
// packages (dist): run `pnpm run build` first.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = join(import.meta.dirname, '..', '..');
const OUT = join(ROOT, 'packages', 'format', '__fixtures__', 'v1.0');
const dist = (pkg) => join(ROOT, 'packages', pkg, 'dist', 'index.js');
for (const pkg of ['format', 'schema']) {
  if (!existsSync(dist(pkg))) {
    console.error(`goldens: packages/${pkg}/dist is missing; run \`pnpm run build\` first`);
    process.exit(1);
  }
}
const { writeFlux } = await import(pathToFileURL(dist('format')).href);
const { parseDocument } = await import(pathToFileURL(dist('schema')).href);

const hasher = { sha256: (bytes) => Promise.resolve(createHash('sha256').update(bytes).digest('hex')) };
const enc = new TextEncoder();
const fixture = (name) => {
  const parsed = parseDocument(readFileSync(join(ROOT, 'fixtures', 'docs', `${name}.flux.json`), 'utf8'));
  if (!parsed.ok) throw new Error(`fixture ${name} does not parse`);
  return parsed.value.document;
};
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

// a plausible WebP header and a plugin bundle: bytes the writer treats as opaque
const webp = enc.encode('RIFF\u0010\u0000\u0000\u0000WEBPVP8 golden-asset');

/** The goldens: name → what to write. */
const GOLDENS = {
  minimal: { document: fixture('minimal') },
  'two-rects-line': { document: fixture('two-rects-line') },
  'shapes-gallery': { document: fixture('shapes-gallery') },
  'rich-text': { document: fixture('rich-text') },
  // everything the writer can carry: an asset, the FluxScript source, a preview, entries and manifest fields of a newer writer
  'assets-and-extras': {
    document: fixture('two-rects-line'),
    assets: new Map([[sha(webp), { bytes: webp, mime: 'image/webp' }]]),
    source: 'flux: 1\nscreens: []\n',
    preview: webp,
    extraEntries: new Map([
      ['plugins/acme.chart@1.0.0/player.js', enc.encode('export default {};\n')],
      ['plugins/acme.chart@1.0.0/fluxion-plugin.json', enc.encode('{"id":"acme.chart"}\n')],
      ['x-newer/notes.txt', enc.encode('written by a newer Fluxion\n')],
    ]),
    manifestExtras: { 'x-newer': { flag: true, level: 3 } },
  },
  // a file whose document is still schema 1.0: it opens migrated, and is not byte-identical when saved again
  'schema-1.0': { document: JSON.parse(readFileSync(join(ROOT, 'packages', 'schema', 'src', '__fixtures__', 'v1.0', 'document.flux.json'), 'utf8')) },
};

const check = process.argv.includes('--check');
let stale = 0;
mkdirSync(OUT, { recursive: true });
for (const [name, input] of Object.entries(GOLDENS)) {
  const zip = await writeFlux({ appVersion: '1.0.0', generator: 'fluxion goldens', hasher, ...input });
  if (!zip.ok) throw new Error(`${name}: ${zip.error.reason}`);
  const text = `${Buffer.from(zip.value).toString('base64')}\n`;
  const file = join(OUT, `${name}.flux.b64`);
  if (check) {
    if (!existsSync(file) || readFileSync(file, 'utf8') !== text) {
      console.error(`goldens: ${name}.flux.b64 is missing or stale`);
      stale++;
    }
  } else writeFileSync(file, text);
}
if (check && stale > 0) process.exit(1);
console.log(check ? `goldens: ${Object.keys(GOLDENS).length} up to date` : `goldens: wrote ${Object.keys(GOLDENS).length}`);
