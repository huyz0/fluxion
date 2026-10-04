#!/usr/bin/env node
// The expected output of the SVG sanitizer for every case of the security corpus (NFR-SEC-001, M10.9): specs/security/corpus/expected/<case>.svg.
// The Node test of `@fluxion/format` and the browser test of `@fluxion/editor` both compare the sanitizer's output with these files, so the
// two hosts are pinned to the same bytes. A change in an expected file is a change in what the sanitizer lets through: review it as one.
//   corpus.mjs           write every expected file
//   corpus.mjs --check   exit 1 when one is missing, stale or has no case
// Reads the built package (dist): run `pnpm run build` first.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = join(import.meta.dirname, '..', '..');
const CORPUS = join(ROOT, 'specs', 'security', 'corpus');
const OUT = join(CORPUS, 'expected');
const DIST = join(ROOT, 'packages', 'format', 'dist', 'index.js');
if (!existsSync(DIST)) {
  console.error('corpus: packages/format/dist is missing; run `pnpm run build` first');
  process.exit(1);
}
const { sanitizeSvg } = await import(pathToFileURL(DIST).href);

const check = process.argv.includes('--check');
const cases = readdirSync(CORPUS).filter((f) => /^svg-.+\.svg$/.test(f));
let stale = 0;
if (!check) mkdirSync(OUT, { recursive: true });
for (const name of cases) {
  const clean = sanitizeSvg(readFileSync(join(CORPUS, name), 'utf8'));
  if (clean === undefined) throw new Error(`${name}: the sanitizer refuses a corpus case outright; the corpus expects a safe SVG back`);
  const file = join(OUT, name);
  if (check) {
    if (!existsSync(file) || readFileSync(file, 'utf8') !== clean) {
      console.error(`corpus: expected/${name} is missing or stale`);
      stale++;
    }
  } else writeFileSync(file, clean);
}
// an expected file with no case is stale too
for (const name of existsSync(OUT) ? readdirSync(OUT) : []) {
  if (cases.includes(name)) continue;
  if (check) {
    console.error(`corpus: expected/${name} has no corpus case`);
    stale++;
  } else rmSync(join(OUT, name));
}
if (check && stale > 0) process.exit(1);
console.log(check ? `corpus: ${cases.length} expected outputs up to date` : `corpus: wrote ${cases.length} expected outputs`);
