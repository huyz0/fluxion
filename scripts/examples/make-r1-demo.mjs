#!/usr/bin/env node
// The R1 demo file (M11.24): `examples/r1-mvp-deck.flux.html`, the demo deck fixture embedded with the built one-file player, one file that opens from `file://` offline.
//   make-r1-demo.mjs            write examples/r1-mvp-deck.flux.html (run `pnpm run build` first)
//   make-r1-demo.mjs --check    fail when the committed file is not what the build makes now (the player inside it has changed)
// The file carries the player of the day it was made: regenerate it when a release wants the demo to show the newest one.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const load = (file) => import(pathToFileURL(resolve(file)).href);
const format = await load('packages/format/dist/index.js');
const schema = await load('packages/schema/dist/index.js');
const hasher = { sha256: (bytes) => Promise.resolve(format.sha256Hex(bytes)) };
const fail = (what, error) => {
  console.error(`make-r1-demo: ${what}: ${JSON.stringify(error)}`);
  process.exit(1);
};

const parsed = schema.parseDocument(readFileSync(resolve('fixtures/docs/r1-mvp-deck.flux.json'), 'utf8'));
if (!parsed.ok) fail('the fixture does not parse', parsed.error);
const flux = await format.writeFlux({ document: parsed.value.document, appVersion: '1.0.0', generator: 'make-r1-demo', hasher });
if (!flux.ok) fail('writeFlux', flux.error);
const html = await format.writeFluxHtml({
  flux: flux.value,
  playerScript: readFileSync(resolve('packages/player-inline/dist/player.inline.js'), 'utf8'),
  title: 'Fluxion in five screens',
  hasher,
});
if (!html.ok) fail('writeFluxHtml', html.error);

const target = resolve('examples/r1-mvp-deck.flux.html');
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== html.value) fail('examples/r1-mvp-deck.flux.html is not what the build makes now', 'run make-r1-demo.mjs');
  console.log('make-r1-demo: examples/r1-mvp-deck.flux.html is up to date');
} else {
  writeFileSync(target, html.value, 'utf8');
  console.log(`make-r1-demo: wrote examples/r1-mvp-deck.flux.html (${html.value.length} bytes)`);
}
