// FR-LIB-004/005/006, NFR-LIC-003: freeze inputs before implementing the converters.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { inflateRawSync } from 'node:zlib';
import { REPO } from './helpers.mjs';

const root = join(REPO, 'specs/import/corpus');
const read = (path) => readFileSync(join(root, path), 'utf8');
const manifest = () => JSON.parse(read('manifest.json'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('FR-LIB-004: SVG corpus pins 50 distinct inputs and feature coverage', () => {
  const m = manifest();
  assert.equal(m.svg.length, 50);
  const texts = m.svg.map((item) => read(item.path));
  assert.equal(new Set(texts.map(sha256)).size, 50);
  assert.equal(new Set(m.svg.map((item) => item.path)).size, 50);
  const features = {
    filled: /fill="(?!none)[^"]+"/,
    stroke: /stroke="[^"]+"/,
    relative: /d="[^"]*[mlhvcsqta][\d\s.,-]/,
    transforms: /transform="/,
    holes: /fill-rule="evenodd"/,
    references: /(?:href="#|url\(#)/,
    gradients: /<(?:linear|radial)Gradient\b/,
    clipping: /<clipPath\b/,
    colors: /#[0-9a-fA-F]{6}\b/,
  };
  for (const [feature, pattern] of Object.entries(features)) {
    const tagged = m.svg.filter((item) => item.features.includes(feature));
    assert.ok(tagged.length > 0, feature);
    for (const item of tagged) assert.match(read(item.path), pattern, `${item.path}: ${feature}`);
  }
  assert.equal(m.svg.filter((item) => item.source === 'lucide').length, 32);
  assert.equal(m.svg.filter((item) => item.source === 'fluxion-original').length, 18);
});

const mxRows = (text) => JSON.parse(text.match(/^<mxlibrary>([\s\S]*)<\/mxlibrary>\s*$/)[1]);

function entryEncoding(row) {
  assert.ok(Number.isFinite(row.w) && row.w > 0 && Number.isFinite(row.h) && row.h > 0);
  if (!row.xml) {
    assert.match(row.data, /^data:image\/svg\+xml;base64,/);
    assert.match(Buffer.from(row.data.split(',')[1], 'base64').toString(), /^<svg\s/);
    return 'svg';
  }
  const plain = /^(?:<|&lt;)/.test(row.xml);
  const xml = plain
    ? row.xml.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')
    : decodeURIComponent(inflateRawSync(Buffer.from(row.xml, 'base64'), { maxOutputLength: 2 * 1024 * 1024 }).toString());
  assert.match(xml, /^<mxGraphModel[\s>]/);
  assert.match(xml, /<mxCell\s/);
  return plain ? 'uncompressed' : 'compressed';
}

function checkEncodings(text, library) {
  const encodings = { uncompressed: 0, compressed: 0, svg: 0 };
  for (const row of mxRows(text)) encodings[entryEncoding(row)]++;
  if (library.encodings) assert.deepEqual(encodings, library.encodings);
  else assert.equal(encodings.compressed, 12);
}

test('FR-LIB-006: draw.io library denominators include every entry', () => {
  const m = manifest();
  assert.equal(m.drawio.length, 3);
  for (const library of m.drawio) {
    const text = read(library.path);
    const count =
      library.kind === 'stencil' ? [...text.matchAll(/<shape\s/g)].length : JSON.parse(text.match(/^<mxlibrary>([\s\S]*)<\/mxlibrary>\s*$/)?.[1] ?? '').length;
    assert.ok(count > 0, library.path);
    assert.equal(count, library.entries, library.path);
    assert.equal(library.denominator, count, library.path);
    if (library.kind === 'mxlibrary') checkEncodings(text, library);
  }
  assert.deepEqual(
    m.drawio.map((item) => item.entries),
    [12, 12, 10],
  );
});

test('NFR-LIC-003: fixture provenance and checksums are valid', () => {
  const m = manifest();
  assert.equal(
    sha256(JSON.stringify(m)),
    '919c02d3b23e888b86e9ea7b5b7f842e5de2302b9d3394e447e23cbbcf732569',
    'frozen manifest changed: review provenance/denominators before changing the seal',
  );
  const sources = new Map(m.sources.map((source) => [source.id, source]));
  assert.equal(sources.size, 4);
  for (const source of sources.values()) {
    assert.ok(['ISC AND MIT', 'Apache-2.0', 'MIT', 'OFL-1.1'].includes(source.license), source.id);
    assert.ok(source.attribution.length > 10, source.id);
    assert.ok(read(source.notice).length > 500, source.id);
    assert.equal(sha256(read(source.notice)), source.noticeSha256, source.id);
    if (source.repository) assert.match(source.commit, /^[a-f0-9]{40}$/);
    else assert.match(source.originalStatement, /Original Fluxion test fixtures/);
  }
  for (const item of [...m.svg, ...m.drawio, ...m.iconify]) {
    assert.ok(sources.has(item.source), item.path);
    assert.match(item.path, /^(svg|drawio|iconify)\/[a-z0-9.-]+$/);
    assert.equal(sha256(read(item.path)), item.sha256, item.path);
    if (sources.get(item.source).repository) {
      assert.ok(item.upstreamPath, item.path);
      const bytes = Buffer.from(read(item.path));
      const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      assert.equal(blob, item.upstreamBlob, item.path);
    }
  }
});

test('FR-LIB-005: complete Iconify collection and alias stress fixtures stay pinned', () => {
  const m = manifest();
  assert.equal(m.iconify.length, 3);
  const collection = JSON.parse(read(m.iconify[0].path));
  assert.equal(Object.keys(collection.icons).length, m.iconify[0].icons);
  assert.equal(m.iconify[0].icons, 1978);
  assert.equal(Object.keys(collection.aliases).length, 220);
  assert.equal(m.iconify[0].aliases, 220);
  const aliases = JSON.parse(read(m.iconify[1].path));
  assert.equal(aliases.width, 32);
  assert.equal(aliases.aliases.mirrored.hFlip, true);
  assert.equal(aliases.aliases.turned.rotate, 1);
  assert.equal(aliases.aliases.nested.parent, 'mirrored');
  assert.equal(aliases.icons.hidden.hidden, true);
  const cycle = JSON.parse(read(m.iconify[2].path));
  assert.equal(cycle.aliases.a.parent, 'b');
  assert.equal(cycle.aliases.b.parent, 'a');
});
