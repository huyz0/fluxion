#!/usr/bin/env node
// Shared document fixtures (testing.md §3: built, never hand-copied): fixtures/docs/*.flux.json
// from the @fluxion/schema/testing builders, in canonical form; examples/shapes-gallery.flux.json is
// the gallery fixture, written here too so the two never drift (M5.25).
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
  set(er2, { markers: { start: 'none', mid: 'diamond', end: 'arrow' }, style: { stroke: { width: 3, dash: [8, 4] } } });
  return doc;
}

/** Cell `k` of the perf-500 grid: its box, a shape of the gallery's, every third labelled. */
function perfCell(k) {
  const [col, row] = [k % 23, Math.floor(k / 23)];
  const label = k % 3 === 0 ? { label: `n${k}` } : {};
  const slug = row === 10 && col === 11 ? { slug: 'drag-me' } : {};
  return { x: 30 + 82 * col, y: 20 + 52 * row, w: 60, h: 36, defId: `basic:${GALLERY_SHAPES[k % GALLERY_SHAPES.length]}`, ...label, ...slug };
}

/**
 * The drag benchmark's document (NFR-PERF-001, M6.23): 500 elements on one 1920 x 1080 screen, 460
 * shapes of the basic pack in a 23 x 20 grid (a third labelled) and 40 connectors joining neighbours,
 * one shape in the middle slugged `drag-me` for the spec to drag.
 */
function perf500() {
  const b = documentBuilder({ title: 'Perf 500', seed: 500 });
  const s = b.screen({ name: 'Five hundred', size: { w: 1920, h: 1080 } });
  const shapes = Array.from({ length: 460 }, (_, k) => b.rect(s, perfCell(k)));
  // 40 connectors between horizontal neighbours of the first two rows
  for (let k = 0; k < 40; k++) {
    const at = (k < 20 ? 0 : 23) + (k % 20);
    b.connect(shapes[at], shapes[at + 1], { route: 'straight' });
  }
  return b.build();
}

/** A text node with `marks` (`[type, attrs?]` pairs). */
const run = (text, ...marks) => ({
  type: 'text',
  text,
  ...(marks.length ? { marks: marks.map(([type, attrs]) => ({ type, ...(attrs ? { attrs } : {}) })) } : {}),
});
const para = (attrs, ...content) => ({ type: 'paragraph', ...(attrs ? { attrs } : {}), content });
const item = (...content) => ({ type: 'listItem', content });

/** The rich text of each element of the rich-text fixture, by the record id in `ids`. */
function richDocs(ids) {
  return {
    [ids.marks]: {
      type: 'doc',
      content: [
        para(
          undefined,
          run('Bold ', ['bold']),
          run('italic ', ['italic']),
          run('underline ', ['underline']),
          run('strike', ['strike']),
          run(' and '),
          run('code', ['code']),
        ),
        para(
          undefined,
          run('red', ['color', { color: '#c62828' }]),
          run(' on '),
          run('yellow', ['highlight', { color: '#fff59d' }]),
          run(' at '),
          run('28 px', ['size', { size: 28 }]),
          run(' and '),
          run('a link', ['link', { href: 'https://example.com', title: 'Example' }]),
        ),
      ],
    },
    [ids.blocks]: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [run('Heading one')] },
        { type: 'heading', attrs: { level: 2 }, content: [run('Heading two')] },
        { type: 'heading', attrs: { level: 3 }, content: [run('Heading three')] },
        para({ align: 'right' }, run('Right aligned, with a field {{page}} after it: '), { type: 'field', attrs: { name: 'page' } }),
        para(
          { lineHeight: 2, spaceBefore: 12, spaceAfter: 12 },
          run('Double spaced with space around, long enough to wrap onto a second line inside this box.'),
        ),
      ],
    },
    [ids.lists]: {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            item(para(undefined, run('First'))),
            item(para(undefined, run('Second')), {
              type: 'bulletList',
              content: [item(para(undefined, run('Nested one'))), item(para(undefined, run('Nested two')))],
            }),
          ],
        },
        { type: 'orderedList', attrs: { start: 3 }, content: [item(para(undefined, run('Third'))), item(para(undefined, run('Fourth')))] },
      ],
    },
    [ids.free]: {
      type: 'doc',
      content: [para(undefined, run('A text element: '), run('bold', ['bold']), run(' and a break'), { type: 'hardBreak' }, run('on the next line.'))],
    },
    [ids.note]: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [run('Note')] },
        para(undefined, run('A heading and two paragraphs in a text element.')),
        para(undefined, run('And a second one.')),
      ],
    },
  };
}

/**
 * The rich-text fixture (FR-TXT-001, M7.14): every mark and block on one screen, in shape labels and in
 * `text` elements, for the edit-versus-present parity suite and the editor's own tests.
 */
function richText() {
  const b = documentBuilder({ title: 'Rich text', seed: 714 });
  const s = b.screen({ name: 'Rich text', size: { w: 1920, h: 1080 } });
  const marks = b.rect(s, { x: 80, y: 60, w: 560, h: 200, defId: 'basic:rect' });
  const blocks = b.rect(s, { x: 700, y: 60, w: 560, h: 420, defId: 'basic:rect' });
  const lists = b.rect(s, { x: 80, y: 320, w: 560, h: 360, defId: 'basic:rect' });
  const free = b.text(s, 'x', { x: 700, y: 540, w: 560, h: 200 });
  const note = b.text(s, 'x', { x: 1320, y: 60, w: 520, h: 300 });
  const docs = richDocs({ marks, blocks, lists, free, note });
  const doc = b.build();
  return { ...doc, records: Object.fromEntries(Object.entries(doc.records).map(([id, r]) => [id, docs[id] ? { ...r, text: docs[id] } : r])) };
}

/**
 * A typical deck without photos (NFR-SIZE-003, M10.20): `count` screens, each with a title, a paragraph of text, four labelled boxes and three connectors, so the file
 * holds what a real deck holds. The size fixture is 20 screens; the open-time fixture (NFR-PERF-003, M11.20) is 50.
 */
function deck(count, title, seed) {
  const b = documentBuilder({ title, seed });
  const TOPICS = ['Context', 'Goals', 'Users', 'Constraints', 'Architecture', 'Data flow', 'Services', 'Storage', 'Security', 'Rollout'];
  for (let n = 1; n <= count; n++) {
    const topic = TOPICS[(n - 1) % TOPICS.length];
    const s = b.screen({ name: `${n}. ${topic}`, size: { w: 1920, h: 1080 } });
    b.text(s, `${n}. ${topic}`, { x: 120, y: 60, w: 1200, h: 120 });
    b.text(s, `What ${topic.toLowerCase()} means for the next release: the plan, who owns it and what is left to decide before the review on the ${n}th.`, {
      x: 120,
      y: 200,
      w: 1100,
      h: 160,
    });
    const boxes = ['Client', 'Gateway', 'Service', 'Store'].map((label, i) =>
      b.rect(s, { x: 120 + i * 440, y: 520, w: 320, h: 200, label, slug: `${label.toLowerCase()}-${n}` }),
    );
    for (let i = 0; i < 3; i++) b.connect(boxes[i], boxes[i + 1]);
  }
  return b.build();
}

const doc20 = () => deck(20, 'Twenty screens', 2020);
const doc50 = () => deck(50, 'Fifty screens', 2050);

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
  'perf-500': perf500,
  'rich-text': richText,
  doc20,
  doc50,
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

/** Examples that are copies of a fixture: `examples/<name>.flux.json`. */
const EXAMPLES = ['shapes-gallery', 'perf-500', 'rich-text'];
const EXAMPLES_DIR = join(ROOT, 'examples');

const wanted = new Map(Object.entries(FIXTURES).map(([name, build]) => [`${name}.flux.json`, serializeDocument(build())]));
const present = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.flux.json')) : [];

if (process.argv.includes('--check')) {
  const problems = [
    ...EXAMPLES.filter(
      (name) =>
        !existsSync(join(EXAMPLES_DIR, `${name}.flux.json`)) ||
        readFileSync(join(EXAMPLES_DIR, `${name}.flux.json`), 'utf8') !== wanted.get(`${name}.flux.json`),
    ).map((name) => `examples/${name}.flux.json is missing or stale`),
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
for (const name of EXAMPLES) writeFileSync(join(EXAMPLES_DIR, `${name}.flux.json`), wanted.get(`${name}.flux.json`));
console.log(`fixtures: wrote ${wanted.size} fixture(s) to fixtures/docs`);
