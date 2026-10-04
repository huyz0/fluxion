import { type DocumentFile, parseDocument } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { writeFlux } from './flux-writer.js';
import { loadFlux } from './loader.js';
import { safeLinkUrl } from './safe-url.js';
import { checkAsset, sanitizeAsset } from './sanitize-asset.js';
import { sanitizeSvg } from './sanitize-svg.js';
import { sha256 } from './testing/sha256.js';
import { decodeUtf8, encodeUtf8 } from './utf8.js';

declare global {
  interface ImportMeta {
    /** Vite's build-time glob import. */
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}

// the security corpus (docs/standards/security.md §7) and the sanitizer's pinned outputs for it (scripts/format/corpus.mjs)
const byName = (files: Record<string, string>) => new Map(Object.entries(files).map(([path, text]) => [path.split('/').at(-1) ?? path, text]));
const CASES = byName(import.meta.glob('../../../specs/security/corpus/svg-*.svg', { query: '?raw', import: 'default', eager: true }));
const EXPECTED = byName(import.meta.glob('../../../specs/security/corpus/expected/svg-*.svg', { query: '?raw', import: 'default', eager: true }));
const LINKS = JSON.parse(
  Object.values(import.meta.glob('../../../specs/security/corpus/links.json', { query: '?raw', import: 'default', eager: true }))[0] ?? '[]',
) as {
  name: string;
  url: string;
  allow: boolean;
}[];
const MINIMAL = Object.values(import.meta.glob('../../../fixtures/docs/minimal.flux.json', { query: '?raw', import: 'default', eager: true }))[0] ?? '';

/** What nothing that survives may hold in a tag: markup that runs, loads or links. */
const FORBIDDEN = [
  /<script/i,
  /\son[a-z]+\s*=/i,
  /javascript:/i,
  /foreignobject/i,
  /<a[\s>]/i,
  /<image/i,
  /<style/i,
  /<set[\s>]/i,
  /<animate/i,
  /<iframe/i,
  /<meta/i,
  /https?:/i,
  /data:/i,
];
const tags = (svg: string) => (svg.match(/<[^>]*>/g) ?? []).join('').replace('xmlns="http://www.w3.org/2000/svg"', '');
const hasher = { sha256: (bytes: Uint8Array) => Promise.resolve(sha256(bytes)) };

const document = (): DocumentFile => {
  const parsed = parseDocument(MINIMAL);
  if (!parsed.ok) throw new Error('fixture does not parse');
  return parsed.value.document;
};

/** Corpus cases whose hostile-looking markup is escaped text: nothing is removed from them, and the loader does not note them. */
const ESCAPED_ONLY = new Set(['svg-nested-onerror-in-text.svg']);

/** One hostile SVG through the whole path: saved as it came, loaded (kept, and noted), drawn (sanitized), saved again, reloaded (clean, a fixed point). */
async function neutralised(name: string, text: string): Promise<void> {
  const hostile = { bytes: encodeUtf8(text), mime: 'image/svg+xml' };
  const hash = sha256(hostile.bytes);
  const saved = await writeFlux({ document: document(), appVersion: '1', hasher, assets: new Map([[hash, hostile]]) });
  if (!saved.ok) throw new Error(saved.error.reason);
  const loaded = await loadFlux(saved.value, { hasher });
  if (!loaded.ok) throw new Error(loaded.error.message);
  const kept = loaded.value.assets.get(hash);
  if (kept === undefined) throw new Error(`${name}: the asset was not loaded`);
  expect(decodeUtf8(kept.bytes), name).toBe(text);
  // every hostile case holds something the allowlist removes, except the one whose hostile-looking markup is only escaped text
  expect(
    loaded.value.notes.some((n) => n.code === 'ASSET_UNSAFE'),
    name,
  ).toBe(!ESCAPED_ONLY.has(name));
  const drawn = sanitizeAsset(kept);
  if (drawn === undefined) throw new Error(`${name}: the sanitizer refused a corpus case`);
  const bare = tags(decodeUtf8(drawn.bytes));
  for (const pattern of FORBIDDEN) expect(bare, `${name}: ${pattern}`).not.toMatch(pattern);
  const cleanHash = sha256(drawn.bytes);
  const resaved = await writeFlux({ document: document(), appVersion: '1', hasher, assets: new Map([[cleanHash, drawn]]) });
  if (!resaved.ok) throw new Error(resaved.error.reason);
  const reloaded = await loadFlux(resaved.value, { hasher });
  if (!reloaded.ok) throw new Error(reloaded.error.message);
  expect(reloaded.value.notes, name).toEqual([]);
  const again = sanitizeAsset(reloaded.value.assets.get(cleanHash) ?? kept);
  expect(decodeUtf8(again?.bytes ?? new Uint8Array()), name).toBe(decodeUtf8(drawn.bytes));
}

describe('the security corpus', () => {
  it('NFR-SEC-001: every case of the security corpus is neutralised through load, render, save and reload', async () => {
    expect(CASES.size).toBeGreaterThanOrEqual(17);
    for (const [name, text] of CASES) await neutralised(name, text);
  });

  it('NFR-SEC-001: the sanitizer gives the same output in Node and in the browser (the pinned outputs of the corpus)', () => {
    expect([...EXPECTED.keys()].sort()).toEqual([...CASES.keys()].sort());
    for (const [name, text] of CASES) expect(sanitizeSvg(text), name).toBe(EXPECTED.get(name));
  });

  it('NFR-SEC-001: only an SVG asset is rewritten; any other asset is returned as it is, and a refused SVG is undefined', () => {
    const png = { bytes: encodeUtf8('<script>alert(1)</script> inside a png is only bytes'), mime: 'image/png' };
    expect(sanitizeAsset(png)).toBe(png);
    expect(sanitizeAsset({ bytes: encodeUtf8('not svg at all'), mime: 'image/svg+xml' })).toBeUndefined();
    expect(sanitizeAsset({ bytes: encodeUtf8('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'), mime: 'image/svg+xml' })?.mime).toBe('image/svg+xml');
    // an SVG with nothing to remove is no note: the loader reports only what changes
  });

  it('NFR-SEC-001: link URLs outside the allowlist are refused and those inside are cleaned', () => {
    expect(LINKS.length).toBeGreaterThanOrEqual(35);
    for (const { name, url, allow } of LINKS) {
      const safe = safeLinkUrl(url);
      expect(safe !== undefined, `${name}: ${JSON.stringify(url)}`).toBe(allow);
      // what comes back is what a browser would read, and still passes
      if (safe !== undefined) expect(safeLinkUrl(safe)).toBe(safe);
    }
    expect(safeLinkUrl('  https://example.com/  ')).toBe('https://example.com/');
    expect(safeLinkUrl(`https://example.com/${'a'.repeat(2100)}`)).toBeUndefined();
    expect(safeLinkUrl('ht\ttps://example.com')).toBe('https://example.com');
  });

  it('NFR-SEC-001: a clean SVG asset opens without an ASSET_UNSAFE note, however it is written: self-closed tags, indentation, comments', async () => {
    const written = [
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>',
      '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">\n  <!-- a comment -->\n  <g fill="#f00">\n    <circle cx="5" cy="5" r="4"/>\n    <text x="1" y="9">a &lt;script&gt; in a label</text>\n  </g>\n  <use href="#a"/>\n</svg>\n',
    ];
    for (const svg of written) {
      const clean = { bytes: encodeUtf8(svg), mime: 'image/svg+xml' };
      const hash = sha256(clean.bytes);
      const saved = await writeFlux({ document: document(), appVersion: '1', hasher, assets: new Map([[hash, clean]]) });
      if (!saved.ok) throw new Error(saved.error.reason);
      const loaded = await loadFlux(saved.value, { hasher });
      expect(loaded.ok && loaded.value.notes, svg).toEqual([]);
      expect(checkAsset(clean), svg).toBe('clean');
    }
  });

  it('NFR-SEC-001: checkAsset tells a changed SVG from a refused one, and ignores other media; the loader words the two notes differently', async () => {
    expect(checkAsset({ bytes: encodeUtf8('<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>'), mime: 'image/svg+xml' })).toBe('changed');
    // a `>` inside a quoted value does not hide the rest of the tag, and `/` can separate attributes
    for (const hostile of [
      '<svg xmlns="http://www.w3.org/2000/svg"><rect title="a>b" onclick="alert(1)"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><a title=\'x>\' href="javascript:alert(1)"><text>t</text></a></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><rect/onload=alert(1)></svg>',
      // a quote in a comment does not hide what follows, and a doctype, an unknown element and a dropped style declaration all count
      '<svg xmlns="http://www.w3.org/2000/svg"><!-- it\'s --><rect onclick="alert(1)" width="1"/><script>x()</script></svg>',
      '<!DOCTYPE svg [<!ENTITY a "b">]><svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><metadata>who made this</metadata><rect/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:red;behavior:url(x.htc)"/></svg>',
      // what the reader never reaches still counts: past the depth cap, past the node cap, and outside the root
      `<svg xmlns="http://www.w3.org/2000/svg">${'<g>'.repeat(70)}<script>x()</script>${'</g>'.repeat(70)}</svg>`,
      `<svg xmlns="http://www.w3.org/2000/svg">${'<rect/>'.repeat(20_010)}<script>x()</script></svg>`,
      '<script>x()</script><svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg><svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>',
    ])
      expect(checkAsset({ bytes: encodeUtf8(hostile), mime: 'image/svg+xml' }), hostile).toBe('changed');
    // hostile shapes that make a careless pattern quadratic: it must finish at once (the test would time out otherwise)
    const head = '<svg xmlns="http://www.w3.org/2000/svg">';
    for (const body of ['<a'.repeat(300_000), `<rect href=${' '.repeat(300_000)}x>`, `<a title="${'>'.repeat(300_000)}`, `<a ${'"'.repeat(300_000)}`])
      expect(['clean', 'changed', 'refused']).toContain(checkAsset({ bytes: encodeUtf8(`${head}${body}</svg>`), mime: 'image/svg+xml' }));
    expect(checkAsset({ bytes: encodeUtf8('plain text'), mime: 'image/svg+xml' })).toBe('refused');
    expect(checkAsset({ bytes: new Uint8Array(4 * 2 * 1024 * 1024 + 1), mime: 'image/svg+xml' })).toBe('refused');
    expect(checkAsset({ bytes: encodeUtf8('<script>'), mime: 'image/png' })).toBe('clean');
    const refused = { bytes: encodeUtf8('this is not an svg'), mime: 'image/svg+xml' };
    const hash = sha256(refused.bytes);
    const saved = await writeFlux({ document: document(), appVersion: '1', hasher, assets: new Map([[hash, refused]]) });
    if (!saved.ok) throw new Error(saved.error.reason);
    const loaded = await loadFlux(saved.value, { hasher });
    expect(loaded.ok && loaded.value.notes.map((n) => n.message).join()).toContain('cannot be drawn');
  });
});
