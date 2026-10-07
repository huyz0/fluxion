import { parseDocument } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { encodeBase64 } from './base64.js';
import { readFluxJson, writeFluxJson } from './flux-json.js';
import { sha256Hex } from './sha256.js';

const DOC_TEXT = import.meta.glob('../../../fixtures/docs/{shapes-gallery,two-rects-line}.flux.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const docOf = (name: string) => {
  const text = Object.entries(DOC_TEXT).find(([p]) => p.endsWith(`/${name}.flux.json`))?.[1] ?? '';
  const r = parseDocument(text);
  if (!r.ok) throw new Error(`fixture ${name}`);
  return r.value.document;
};
const hasher = { sha256: (b: Uint8Array) => Promise.resolve(sha256Hex(b)) };
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const font = Uint8Array.from([0x77, 0x4f, 0x46, 0x32, 9, 9]);
const assets = new Map([
  [sha256Hex(png), { bytes: png, mime: 'image/png' }],
  [sha256Hex(font), { bytes: font, mime: 'font/woff2' }],
]);
const write = async (doc = docOf('shapes-gallery'), extra = {}) => {
  const r = await writeFluxJson({ document: doc, assets, appVersion: '1.0.0', hasher, source: 'flux: 1\n', ...extra });
  if (!r.ok) throw new Error(r.error.reason);
  return r.value;
};
/** The same document with every object's keys in reverse order. */
const reversed = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(reversed)
    : v !== null && typeof v === 'object'
      ? Object.fromEntries(
          Object.entries(v)
            .reverse()
            .map(([k, x]) => [k, reversed(x)]),
        )
      : v;

describe('.flux.json (FR-FIL-005)', () => {
  it('FR-FIL-005: an identical document written twice gives byte-identical files, whatever its key order', async () => {
    const a = await write();
    const b = await write();
    expect(b.text).toBe(a.text);
    const shuffled = await write(reversed(docOf('shapes-gallery')) as ReturnType<typeof docOf>);
    expect(shuffled.text).toBe(a.text);
    // canonical: sorted keys at every depth, 2-space indent, LF, a trailing newline
    expect(a.text.endsWith('}\n')).toBe(true);
    expect(a.text.includes('\r')).toBe(false);
    const keys = Object.keys(JSON.parse(a.text));
    expect(keys).toEqual([...keys].sort());
    expect(keys).toEqual(['assets', 'fluxion', 'manifest', 'records', 'schemaVersion', 'source']);
    expect(a.text).toContain('\n  "fluxion": "1.0",\n');
  });

  it("FR-FIL-005: the document's own theme is written as its DTCG tokens", async () => {
    const doc = docOf('two-rects-line');
    const [docId, docRecord] = Object.entries(doc.records).find(([, r]) => r.type === 'document') ?? [];
    const themed = {
      ...doc,
      records: {
        ...doc.records,
        [docId as string]: { ...docRecord, themeId: 'th' },
        th: { id: 'th', type: 'theme', name: 'T', tokens: { color: { a: { $value: '#000' } } } },
      },
    };
    const out = JSON.parse((await write(themed as typeof doc)).text) as { theme?: unknown };
    expect(out.theme).toEqual({ color: { a: { $value: '#000' } } });
  });

  it('FR-FIL-005: geometry is rounded to 1e-3 and -0 written as 0, other numbers exactly', async () => {
    const doc = docOf('two-rects-line');
    const [id, el] = Object.entries(doc.records).find(([, r]) => r.type === 'element' && 'transform' in r) ?? [];
    const nudged = {
      ...doc,
      records: {
        ...doc.records,
        [id as string]: { ...el, transform: { ...(el as { transform: object }).transform, x: 10.12345, y: -0 }, 'x-extra': 0.123456789 },
      },
    };
    const out = JSON.parse((await write(nudged as typeof doc)).text) as { records: Record<string, { transform: { x: number; y: number }; 'x-extra': number }> };
    const back = out.records[id as string];
    expect(back?.transform.x).toBe(10.123);
    expect(Object.is(back?.transform.y, -0)).toBe(false);
    expect(back?.['x-extra']).toBe(0.123456789);
  });

  it('FR-FIL-005: inline assets read back as the same bytes, and the document and source round-trip', async () => {
    const out = await write();
    expect(out.files).toEqual([]);
    const r = readFluxJson(out.text);
    if (!r.ok) throw new Error(r.error.reason);
    expect([...r.value.assets.keys()]).toEqual([...assets.keys()].sort());
    expect(r.value.assets.get(sha256Hex(png))).toEqual({ bytes: png, mime: 'image/png' });
    expect(r.value.source).toBe('flux: 1\n');
    const again = await write(r.value.document);
    expect(again.text).toBe(out.text);
  });

  it('FR-FIL-005: external assets are written beside the JSON by hash and read back', async () => {
    const out = await write(undefined, { assetsMode: 'external', name: 'deck' });
    expect(out.files.map((f) => f.path)).toEqual([`deck.assets/${sha256Hex(png)}.png`, `deck.assets/${sha256Hex(font)}.woff2`].sort());
    expect(out.text).not.toContain('base64');
    const disk = new Map(out.files.map((f) => [f.path, f.bytes]));
    const r = readFluxJson(out.text, (p) => disk.get(p));
    if (!r.ok) throw new Error(r.error.reason);
    expect(r.value.assets.get(sha256Hex(font))?.bytes).toEqual(font);
    // a missing file, an unsafe path, bad base64 and a missing media type are refused with a reason
    expect(readFluxJson(out.text).ok).toBe(false);
    // only <name>.assets/<its hash>.<ext> may be read: no parent steps, drives, backslashes, dot files or another asset's name
    const at = `deck.assets/${sha256Hex(png)}.png`;
    for (const evil of [
      '../etc/passwd',
      'C:/Users/me/.ssh/id_rsa',
      '..\\..\\secrets.env',
      '.env',
      `.x.assets/${sha256Hex(png)}.png`,
      `deck.assets/${sha256Hex(font)}.png`,
      `/deck.assets/${sha256Hex(png)}.png`,
      `a/deck.assets/${sha256Hex(png)}.png`,
    ]) {
      expect(
        readFluxJson(out.text.replace(at, evil.replaceAll('\\', '\\\\')), (p) => disk.get(p) ?? png),
        evil,
      ).toMatchObject({ ok: false, error: { reason: expect.stringContaining('safe path') } });
    }
    // bytes that changed under the same hash are refused, on disk or inline
    expect(readFluxJson(out.text, (p) => (p === at ? font : disk.get(p)))).toMatchObject({
      ok: false,
      error: { reason: expect.stringContaining('has the hash') },
    });
    const inline = (await write()).text;
    const swapped = inline.replace(`"base64": "${encodeBase64(png)}"`, `"base64": "${encodeBase64(font)}"`);
    expect(readFluxJson(swapped)).toMatchObject({ ok: false, error: { reason: expect.stringContaining('has the hash') } });
    expect(readFluxJson(inline.replace(/"base64": "[^"]+"/, '"base64": "!!"'))).toMatchObject({ ok: false });
    expect(readFluxJson(inline.replace('"mime": "image/png"', '"mime": 5'))).toMatchObject({ ok: false });
  });

  it('FR-FIL-005: an asset of a media type with no known extension, or a long one, keeps its file name through a round trip', async () => {
    const blob = Uint8Array.from([1, 2, 3, 4]);
    const own = new Map([[sha256Hex(blob), { bytes: blob, mime: 'application/x-thing', ext: 'thingamajig' }]]);
    const first = await writeFluxJson({ document: docOf('two-rects-line'), assets: own, appVersion: '1', hasher, assetsMode: 'external', name: 'd' });
    if (!first.ok) throw new Error(first.error.reason);
    expect(first.value.files.map((f) => f.path)).toEqual([`d.assets/${sha256Hex(blob)}.thingamajig`]);
    const disk = new Map(first.value.files.map((f) => [f.path, f.bytes]));
    const read = readFluxJson(first.value.text, (p) => disk.get(p));
    if (!read.ok) throw new Error(read.error.reason);
    expect(read.value.assets.get(sha256Hex(blob))?.ext).toBe('thingamajig');
    const again = await writeFluxJson({ document: read.value.document, assets: read.value.assets, appVersion: '1', hasher, assetsMode: 'external', name: 'd' });
    expect(again.ok && again.value.text).toBe(first.value.text);
    // inline too: the extension rides beside the bytes
    const inline = await writeFluxJson({ document: docOf('two-rects-line'), assets: own, appVersion: '1', hasher });
    if (!inline.ok) throw new Error(inline.error.reason);
    expect(inline.value.text).toContain('"ext": "thingamajig"');
    const back = readFluxJson(inline.value.text);
    expect(back.ok && back.value.assets.get(sha256Hex(blob))?.ext).toBe('thingamajig');
  });

  it('FR-FIL-005: a key that is not the hash of its bytes, text that is not JSON and a file without a version are refused', async () => {
    const bad = await writeFluxJson({
      document: docOf('two-rects-line'),
      assets: new Map([['00', { bytes: png, mime: 'image/png' }]]),
      appVersion: '1',
      hasher,
    });
    expect(bad).toMatchObject({ ok: false, error: { reason: expect.stringContaining('has the hash') } });
    expect(readFluxJson('not json')).toMatchObject({ ok: false });
    // an assets folder name the reader would refuse is refused when writing
    for (const name of ['.deck', 'a:b', '../x', 'a/b', 'a\\b']) {
      expect(await writeFluxJson({ document: docOf('two-rects-line'), assets, appVersion: '1', hasher, assetsMode: 'external', name }), name).toMatchObject({
        ok: false,
      });
    }
    expect(readFluxJson('{"records":{}}')).toMatchObject({ ok: false, error: { reason: expect.stringContaining('fluxion') } });
    expect(readFluxJson('{"fluxion":"1.0","schemaVersion":"1.3","records":5}')).toMatchObject({ ok: false });
  });
});
