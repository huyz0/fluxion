#!/usr/bin/env node
// Shared document fixtures (testing.md §3: built, never hand-copied): fixtures/docs/*.flux.json
// from the @fluxion/schema/testing builders, in canonical form.
//   gen.mjs            write every fixture (and delete stale ones)
//   gen.mjs --check    exit 1 when a fixture is missing, stale or not generated here
// Names say how a fixture behaves: `invalid-<code>` fails validation with FLX_<CODE>, every other
// fixture parses with no error (packages/schema: "fixtures/docs behave as named").
// Reads the built package (dist): run `pnpm run build` first.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = join(import.meta.dirname, '..', '..');
const DIR = join(ROOT, 'fixtures', 'docs');
const DIST = join(ROOT, 'packages', 'schema', 'dist');
if (!existsSync(join(DIST, 'testing', 'index.js'))) {
  console.error('fixtures: packages/schema/dist is missing; run `pnpm run build` first');
  process.exit(1);
}
const { serializeDocument } = await import(pathToFileURL(join(DIST, 'index.js')).href);
const { documentBuilder } = await import(pathToFileURL(join(DIST, 'testing', 'index.js')).href);

function twoRectsLine(title) {
  const b = documentBuilder({ title, seed: 2 });
  const s = b.screen({ name: 'Main' });
  const a = b.rect(s, { x: 120, y: 200, label: 'Client', slug: 'client' });
  const c = b.rect(s, { x: 520, y: 200, label: 'Server', slug: 'server' });
  const line = b.connect(a, c);
  return { doc: b.build(), screen: s, rect: a, line };
}

/** Put `patch` into record `id` of `doc` (a copy). */
const patched = (doc, id, patch) => ({ ...doc, records: { ...doc.records, [id]: { ...doc.records[id], ...patch } } });

/** A plain rich-text document of one paragraph. */
const plain = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

/** The 21 basic shapes (FR-SHP-002) in the gallery's grid, with a label each. */
const GALLERY_SHAPES = [
  'rect',
  'rounded-rect',
  'ellipse',
  'triangle',
  'diamond',
  'parallelogram',
  'trapezoid',
  'hexagon',
  'octagon',
  'star',
  'block-arrow',
  'callout',
  'cloud',
  'cylinder',
  'document',
  'note',
  'line',
  'polyline',
  'freehand',
  'text-box',
  'image-frame',
];

/**
 * The shapes gallery (FR-SHP-002, FR-CON-002, FR-CON-003; M5.24): every basic shape in a 7 x 3 grid,
 * then connectors of the four route types between four more shapes and between free points, carrying
 * every built-in and basic-pack marker (at stroke width 4, large enough for the visual diff to see: M5.24
 * review F1), labels, a corner radius, and text-fit fields (ADR-0018). Static HTML does not measure
 * text, so the gallery does not exercise the fitting itself (M5.24 review F2).
 */
function shapesGallery() {
  const b = documentBuilder({ title: 'Shapes gallery', seed: 524 });
  const s = b.screen({ name: 'Gallery', size: { w: 1920, h: 1080 } });
  const cells = GALLERY_SHAPES.map((name, k) => {
    const [col, row] = [k % 7, Math.floor(k / 7)];
    return b.rect(s, { x: 80 + 260 * col, y: 60 + 170 * row, w: 180, h: 110, defId: `basic:${name}`, label: name, slug: `shape-${name}` });
  });
  // the connector band: four bound shapes and routes of every type between them
  const a = b.rect(s, { x: 120, y: 640, w: 180, h: 100, defId: 'basic:rect', label: 'A', slug: 'a' });
  const c = b.rect(s, { x: 620, y: 600, w: 180, h: 110, defId: 'basic:ellipse', label: 'B', slug: 'b' });
  const d = b.rect(s, { x: 120, y: 900, w: 160, h: 120, defId: 'basic:diamond', label: 'C', slug: 'c' });
  const e = b.rect(s, { x: 640, y: 880, w: 160, h: 120, defId: 'basic:hexagon', label: 'D', slug: 'd' });
  const straight = b.connect(a, c, { route: 'straight' });
  const curved = b.connect(a, d, { route: 'curved', sourceAnchor: { kind: 'named', name: 's' }, targetAnchor: { kind: 'named', name: 'n' } });
  const orthogonal = b.connect(c, e, { route: 'orthogonal', sourceAnchor: { kind: 'named', name: 'e' }, targetAnchor: { kind: 'named', name: 'e' } });
  const polyline = b.connect(d, e, { route: 'polyline' });
  // free-standing connectors for the crow's-foot markers
  const er1 = b.connect({ x: 1000, y: 640 }, { x: 1400, y: 640 }, { route: 'straight' });
  const er2 = b.connect({ x: 1000, y: 760 }, { x: 1400, y: 900 }, { route: 'orthogonal' });
  const doc = b.build();
  const set = (id, patch) => {
    doc.records[id] = { ...doc.records[id], ...patch };
  };
  // text-fit fields (ADR-0018): a note set to grow with its text, a callout set to shrink it. Their
  // texts fit as written, so the static HTML (which never measures) draws them cleanly; the fitting
  // itself is tested where text is measured (render's browser tests, M5.14)
  set(cells[GALLERY_SHAPES.indexOf('note')], {
    text: plain('a note grows to fit its text, however long it runs'),
    textFit: { mode: 'grow' },
  });
  set(cells[GALLERY_SHAPES.indexOf('callout')], {
    text: plain('a callout shrinks its text to fit'),
    textFit: { mode: 'shrink', minSize: 8 },
  });
  const thick = { stroke: { width: 4 } };
  set(straight, { style: thick, markers: { start: 'circle', end: 'arrow' }, labels: [{ text: plain('straight'), position: 0.5, offset: { x: 0, y: -14 } }] });
  set(curved, { style: thick, markers: { start: 'diamond', end: 'triangle' }, labels: [{ text: plain('curved'), position: 0.5 }] });
  set(orthogonal, {
    style: thick,
    route: { type: 'orthogonal', cornerRadius: 12 },
    markers: { start: 'bar', end: 'basic:open-arrow' },
    labels: [{ text: plain('orthogonal'), position: 0.5 }],
  });
  set(polyline, {
    style: thick,
    route: { type: 'polyline', waypoints: [{ x: 460, y: 1050 }] },
    markers: { start: 'basic:crows-foot-one', end: 'basic:crows-foot-many' },
  });
  set(er1, {
    style: thick,
    markers: { start: 'basic:crows-foot-zero-one', end: 'basic:crows-foot-zero-many' },
    labels: [{ text: plain('zero or one — zero or many'), position: 0.5, offset: { x: 0, y: -14 } }],
  });
  set(er2, { markers: { start: 'none', end: 'arrow' }, style: { stroke: { width: 3, dash: [8, 4] } } });
  return doc;
}

const FIXTURES = {
  minimal: () => {
    const b = documentBuilder({ title: 'Minimal', seed: 1 });
    b.screen({ name: 'Main' });
    return b.build();
  },
  'two-rects-line': () => twoRectsLine('Two rects and a line').doc,
  // a plugin element kind, a core kind from a newer version (FLX_KIND_UNKNOWN warning, M2 final F7)
  // and unknown fields are all kept verbatim (FR-DOC-005)
  'unknown-kind': () => {
    const { doc, screen } = twoRectsLine('Unknown kind');
    const gauge = {
      id: 'GaugeGaugeGauge1',
      type: 'element',
      screenId: screen,
      index: 'a9',
      kind: 'acme:gauge',
      transform: { x: 120, y: 400, w: 160, h: 80 },
      props: { value: 0.42 },
      future: { x: 1 },
    };
    const hologram = {
      id: 'HologramHologram',
      type: 'element',
      screenId: screen,
      index: 'aA',
      kind: 'hologram',
      transform: { x: 320, y: 400, w: 160, h: 80 },
      depth: 3,
    };
    return { ...doc, records: { ...doc.records, [gauge.id]: gauge, [hologram.id]: hologram } };
  },
  'shapes-gallery': shapesGallery,
  // an element on a screen that does not exist
  'invalid-ref-missing': () => {
    const { doc, rect } = twoRectsLine('Missing screen');
    return patched(doc, rect, { screenId: 'NoSuchScreen0000' });
  },
  // a record that does not match its schema
  'invalid-schema-invalid': () => {
    const { doc, rect } = twoRectsLine('Bad transform');
    return patched(doc, rect, { transform: { x: 0, y: 0, w: 'wide', h: 80 } });
  },
};

const wanted = new Map(Object.entries(FIXTURES).map(([name, build]) => [`${name}.flux.json`, serializeDocument(build())]));
const present = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.flux.json')) : [];

if (process.argv.includes('--check')) {
  const problems = [
    ...[...wanted].filter(([f, text]) => !present.includes(f) || readFileSync(join(DIR, f), 'utf8') !== text).map(([f]) => `${f} is missing or stale`),
    ...present.filter((f) => !wanted.has(f)).map((f) => `${f} is not generated by scripts/fixtures/gen.mjs`),
  ];
  for (const p of problems) console.error(`fixtures: ${p}`);
  if (problems.length) console.error('Run `node scripts/fixtures/gen.mjs` and commit the result.');
  else console.log(`fixtures: ${wanted.size} fixture(s) current`);
  process.exit(problems.length ? 1 : 0);
}

mkdirSync(DIR, { recursive: true });
for (const f of present.filter((f) => !wanted.has(f))) rmSync(join(DIR, f));
for (const [f, text] of wanted) writeFileSync(join(DIR, f), text);
console.log(`fixtures: wrote ${wanted.size} fixture(s) to fixtures/docs`);
