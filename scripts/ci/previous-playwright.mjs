#!/usr/bin/env node
// The nightly's previous-major browser check (NFR-PORT-001, M11.23): the whole e2e suite once more on the Playwright release before the one the repository pins, so a
// suite that only passes on today's browsers and test runner is found before a release depends on it. The workflow runs this to point the catalog of
// pnpm-workspace.yaml at that release, then installs without the frozen lockfile (the change is the run's own and is never committed).
//   previous-playwright.mjs            rewrite pnpm-workspace.yaml in place and print the two pins it set
//   previous-playwright.mjs --check    print what would change, write nothing
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The release the nightly runs the suite on: one minor before the pinned one. Move it forward when the catalog's Playwright moves. */
export const PREVIOUS = '1.62.1';

const PIN = /^(\s*(?:playwright|"@playwright\/test"):\s*)(\d+\.\d+\.\d+)(.*)$/gm;

/** `text` (pnpm-workspace.yaml) with the `playwright` and `@playwright/test` catalog entries set to `version`. */
export function pinPrevious(text, version = PREVIOUS) {
  return text.replace(PIN, (_all, head, _old, tail) => `${head}${version}${tail}`);
}

/** The versions the `playwright` and `@playwright/test` entries of `text` hold. */
export function pinsOf(text) {
  return [...text.matchAll(PIN)].map((m) => m[2]);
}

/** Whether version `a` is older than `b` (dotted numbers). */
export function olderThan(a, b) {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] ?? 0) < (y[i] ?? 0);
  return false;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = new URL('../../pnpm-workspace.yaml', import.meta.url);
  const before = readFileSync(file, 'utf8');
  const pins = pinsOf(before);
  if (pins.length !== 2) {
    console.error(`previous-playwright: expected the playwright and @playwright/test catalog entries, found ${pins.length}`);
    process.exit(1);
  }
  if (!pins.every((v) => olderThan(PREVIOUS, v))) {
    console.error(`previous-playwright: ${PREVIOUS} is not older than the pinned ${pins.join(' and ')}: move PREVIOUS back one minor`);
    process.exit(1);
  }
  if (!process.argv.includes('--check')) writeFileSync(file, pinPrevious(before));
  console.log(`previous-playwright: ${pins.join(' and ')} -> ${PREVIOUS}${process.argv.includes('--check') ? ' (check only)' : ''}`);
}
