#!/usr/bin/env node
// Builds the Google Fonts catalog of the studio's font picker (ADR-0022, FR-THM-008): a committed snapshot of the families under the
// font-licence allowlist, so the picker works offline and nothing asks Google for a list.
//   node scripts/fonts/build-catalog.mjs            fetch the pinned source, write packs/fonts-core/catalog.json
//   node scripts/fonts/build-catalog.mjs --check    fail when the committed catalog differs from the pinned source
// The source is the npm package google-font-metadata (MIT; the Fontsource project's mirror of the Google Fonts API and of the
// google/fonts repository's METADATA.pb and licence files), pinned by version and checked against the registry's integrity.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchNpmPackage } from './npm-package.mjs';

const CATALOG = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'packs', 'fonts-core', 'catalog.json');
const SOURCE = { name: 'google-font-metadata', version: '6.0.8' };
/** The licences of the font allowlist (FONT_LICENSES in thresholds.mjs), by the name the source gives them; the Ubuntu Font Licence is left out. */
const LICENSES = { 'SIL Open Font License, 1.1': 'OFL-1.1', 'Apache License, Version 2.0': 'Apache-2.0' };

/** The JSON of `path` in the package. */
const read = (pkg, path) => JSON.parse(pkg.files.find((f) => f.name === `package/data/${path}`)?.data.toString('utf8') ?? 'null');

/** The catalog of the package: a family with a known licence on the allowlist, with what the picker lists. */
export function catalogOf(pkg) {
  const fonts = read(pkg, 'google-fonts-v2.json');
  const licenses = read(pkg, 'licenses.json');
  const categories = new Map(read(pkg, 'api-response.json').map((f) => [f.family, f.category]));
  const families = Object.values(fonts).flatMap((f) => {
    const license = LICENSES[licenses[f.id]?.license?.type];
    if (license === undefined) return [];
    return [
      {
        family: f.family,
        id: f.id,
        category: categories.get(f.family) ?? 'sans-serif',
        weights: f.weights,
        styles: f.styles,
        subsets: f.subsets,
        license,
        copyright: String(licenses[f.id].original ?? licenses[f.id].authors?.copyright ?? '').trim(),
      },
    ];
  });
  families.sort((a, b) => a.family.localeCompare(b.family, 'en'));
  return { source: `${SOURCE.name}@${SOURCE.version}`, families };
}

/** The catalog file's text: one family per line. */
export const catalogText = (catalog) =>
  `{\n  "source": ${JSON.stringify(catalog.source)},\n  "families": [\n${catalog.families.map((f) => `    ${JSON.stringify(f)}`).join(',\n')}\n  ]\n}\n`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const catalog = catalogOf(await fetchNpmPackage(SOURCE.name, SOURCE.version));
  const text = catalogText(catalog);
  if (process.argv.includes('--check')) {
    if (readFileSync(CATALOG, 'utf8') !== text) {
      console.error('catalog: packs/fonts-core/catalog.json differs from the pinned source; run node scripts/fonts/build-catalog.mjs');
      process.exit(1);
    }
    console.log('catalog: the committed catalog matches the pinned source');
  } else {
    writeFileSync(CATALOG, text);
    console.log(`catalog: ${catalog.families.length} families written to packs/fonts-core/catalog.json`);
  }
}
