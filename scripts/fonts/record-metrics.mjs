#!/usr/bin/env node
// Record font metrics from the engine that draws the text (FR-TXT-002, ADR-0148).
//   node scripts/fonts/record-metrics.mjs [--check]
// Loads each font of fixtures/fonts in Chromium and measures, in the DOM (which is what draws text:
// a canvas does not kern across a space, the DOM does) at 1000 px so one unit is a thousandth of an
// em, every character, every two-character sequence of the alphabet and every three-letter sequence
// (ligatures such as ffi); the latter two are recorded as what they add to the sum of their parts. Writes
//   fixtures/fonts/roboto.metrics.json    the faces' metrics (packages/core/src/text/metrics.ts)
//   fixtures/fonts/roboto.rendered.json   what the DOM renders for a set of samples: their width and
//                                         height, the reference the parity tests compare against
// --check records into memory and fails when either file would change (the metrics by more than
// a hundredth of a unit, the rendered sizes by more than a hundredth of a px).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = join(ROOT, 'fixtures', 'fonts');
const FACES = [
  { file: 'roboto-400.woff2', family: 'Roboto', weight: 400, style: 'normal' },
  { file: 'roboto-700.woff2', family: 'Roboto', weight: 700, style: 'normal' },
];
const UNITS = 1000;
const ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');
const TYPOGRAPHY = '–—‘’“”•…€™';
const LATIN1 = Array.from({ length: 64 }, (_, i) => String.fromCharCode(0xc0 + i)).join('');
/** Every character with an advance; pairs are recorded among the first two sets. */
const PAIRED = ASCII + TYPOGRAPHY;
const ALPHABET = PAIRED + LATIN1;
/** The letters ligatures are made of: three-letter sequences are recorded for these. */
const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** The samples whose rendered size is recorded: strings in a few sizes and weights. */
const TEXTS = [
  'Fluxion',
  'The quick brown fox jumps over the lazy dog',
  'AVATAR Tavern WAVE Yo-yo To We Ty Va',
  'Sphinx of black quartz, judge my vow.',
  'Pack my box with five dozen liquor jugs',
  'ffi fl fi office affluent difficult',
  '0123456789 +-*/=<> (a[b]{c}) 100% $5 #1',
  'Wide MMMM WWWW and narrow iiii llll',
  'He said “hello” – then left… — it’s 3€ ™',
  'Café déjà vu façade naïve Zürich',
  'one line\nand a second line\nand a third, longer line of text',
  'A paragraph of running text that goes on for a while so that small differences in each advance add up across the line.',
];
const VARIANTS = [
  { size: 16, weight: 400 },
  { size: 14, weight: 700 },
  { size: 24, weight: 400 },
  { size: 12, weight: 700 },
];

const round = (n, digits) => Math.round(n * 10 ** digits) / 10 ** digits;

async function record() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><meta charset="utf-8"><body></body>');
    await page.addScriptTag({ path: join(dirname(fileURLToPath(import.meta.url)), 'page-recorder.js') });
    const fonts = FACES.map((f) => ({ ...f, data: readFileSync(join(DIR, f.file)).toString('base64') }));
    const args = { fonts, alphabet: ALPHABET, paired: PAIRED, letters: LETTERS, units: UNITS, texts: TEXTS, variants: VARIANTS };
    return await page.evaluate((a) => window.fluxionRecordFonts(a), args);
  } finally {
    await browser.close();
  }
}

/** The metrics file's text: one face per line group, numbers to a hundredth of a unit. */
function metricsText(faces) {
  const rounded = faces.map((f) => ({
    ...f,
    defaultAdvance: round(f.defaultAdvance, 2),
    advances: Object.fromEntries(Object.entries(f.advances).map(([k, v]) => [k, round(v, 2)])),
    pairs: Object.fromEntries(Object.entries(f.pairs).map(([k, v]) => [k, round(v, 2)])),
    triples: Object.fromEntries(Object.entries(f.triples).map(([k, v]) => [k, round(v, 2)])),
  }));
  return `${JSON.stringify({ faces: rounded })}\n`;
}

/** The rendered file's text. */
function renderedText(samples, userAgent) {
  const body = samples.map((s) => JSON.stringify({ ...s, width: round(s.width, 3), height: round(s.height, 3) })).join(',\n  ');
  return `{\n  "font": "Roboto",\n  "recordedWith": ${JSON.stringify(userAgent.replace(/^.*(Chrome\/[\d.]+).*$/, '$1'))},\n  "samples": [\n  ${body}\n  ]\n}\n`;
}

const { faces, samples, userAgent } = await record();
const files = { 'roboto.metrics.json': metricsText(faces), 'roboto.rendered.json': renderedText(samples, userAgent) };
if (process.argv.includes('--check')) {
  const drift = [];
  for (const [name, text] of Object.entries(files)) {
    const now = JSON.parse(text);
    const then = JSON.parse(readFileSync(join(DIR, name), 'utf8'));
    const numbers = (v) => (typeof v === 'number' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(numbers) : []);
    const [a, b] = [numbers(now), numbers(then)];
    if (a.length !== b.length || a.some((n, i) => Math.abs(n - b[i]) > 0.01)) drift.push(name);
  }
  if (drift.length > 0) {
    console.error(`record-metrics: ${drift.join(', ')} differ from this browser; run node scripts/fonts/record-metrics.mjs`);
    process.exit(1);
  }
  console.log('record-metrics: the committed metrics match this browser');
} else {
  for (const [name, text] of Object.entries(files)) writeFileSync(join(DIR, name), text);
  console.log(`record-metrics: wrote ${Object.keys(files).join(' and ')} (${userAgent})`);
}
