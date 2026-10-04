import { type DocumentFile, parseDocument, type RecordId } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { FLUX_MIMETYPE, writeFlux } from './flux-writer.js';
import { decodeUtf8, encodeUtf8 } from './utf8.js';
import { readZip, type ZipEntry } from './zip.js';

declare global {
  interface ImportMeta {
    /** Vite's build-time glob import. */
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}

const FIXTURES = import.meta.glob('../../../fixtures/docs/{minimal,shapes-gallery}.flux.json', { query: '?raw', import: 'default', eager: true });
const fixtureDocument = (name: string): DocumentFile => {
  const text = Object.entries(FIXTURES).find(([path]) => path.endsWith(name))?.[1] ?? '';
  const parsed = parseDocument(text);
  if (!parsed.ok) throw new Error(`fixture ${name} does not parse`);
  return parsed.value.document;
};

// SHA-256 (FIPS 180-4), here only so the tests need no `node:crypto`; hosts pass SubtleCrypto or the like
const K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74,
  0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d,
  0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e,
  0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
function sha256(data: Uint8Array): string {
  const padded = new Uint8Array(((data.length + 9 + 63) >> 6) << 6);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor((data.length * 8) / 2 ** 32));
  view.setUint32(padded.length - 4, (data.length * 8) >>> 0);
  const h = Uint32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15] as number;
      const b = w[i - 2] as number;
      w[i] = ((w[i - 16] as number) + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + (w[i - 7] as number) + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as unknown as number[] as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + (K[i] as number) + (w[i] as number)) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, hh].forEach((v, i) => {
      h[i] = ((h[i] as number) + v) >>> 0;
    });
  }
  return Array.from(h, (v) => v.toString(16).padStart(8, '0')).join('');
}
const hasher = { sha256: (bytes: Uint8Array) => Promise.resolve(sha256(bytes)) };
const text = (s: string) => encodeUtf8(s);

const entriesOf = async (doc: DocumentFile, extra: Partial<Parameters<typeof writeFlux>[0]> = {}): Promise<ZipEntry[]> => {
  const zip = await writeFlux({ document: doc, appVersion: '0.0.0', hasher, ...extra });
  if (!zip.ok) throw new Error(zip.error.reason);
  const read = readZip(zip.value);
  if (!read.ok) throw new Error(read.error.reason);
  return read.value;
};
const bytesOf = (entries: readonly ZipEntry[], name: string): Uint8Array => entries.find((e) => e.name === name)?.bytes ?? new Uint8Array();

describe('the SHA-256 the tests hash with', () => {
  it('FR-FIL-003: matches the standard test vectors', () => {
    expect(sha256(text('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256(new Uint8Array(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256(text('a'.repeat(1000)))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
  });
});

describe('writeFlux', () => {
  const doc = fixtureDocument('shapes-gallery.flux.json');

  it('FR-FIL-003: the same document written twice gives byte-identical .flux files', async () => {
    const a = await writeFlux({ document: doc, appVersion: '1.2.3', hasher });
    const b = await writeFlux({ document: doc, appVersion: '1.2.3', hasher });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(Array.from(a.value)).toEqual(Array.from(b.value));
  });

  it('FR-FIL-003: mimetype is the first entry, stored, and names the media type; manifest.json is second', async () => {
    const zip = await writeFlux({ document: doc, appVersion: '1.2.3', hasher });
    if (!zip.ok) throw new Error(zip.error.reason);
    expect(decodeUtf8(zip.value.subarray(30, 38))).toBe('mimetype');
    expect(decodeUtf8(zip.value.subarray(38, 38 + FLUX_MIMETYPE.length))).toBe(FLUX_MIMETYPE);
    const entries = await entriesOf(doc);
    expect(entries.map((e) => e.name).slice(0, 3)).toEqual(['mimetype', 'manifest.json', 'document.json']);
    expect(entries[0]?.method).toBe('store');
  });

  it('FR-FIL-003: the manifest hashes every entry but mimetype and itself, and names the document', async () => {
    const entries = await entriesOf(doc, { generator: 'test 1', appVersion: '9.9.9' });
    const manifest = JSON.parse(decodeUtf8(bytesOf(entries, 'manifest.json'))) as {
      format: string;
      formatVersion: string;
      schemaVersion: string;
      app: { name: string; version: string };
      generator: string;
      entries: { [name: string]: { sha256: string; size: number } };
      bakes: { routes: boolean; snapshots: boolean };
    };
    expect(manifest).toMatchObject({
      format: 'fluxion',
      formatVersion: '1.0',
      schemaVersion: doc.schemaVersion,
      app: { name: 'fluxion', version: '9.9.9' },
      generator: 'test 1',
    });
    const hashed = entries.filter((e) => e.name !== 'mimetype' && e.name !== 'manifest.json');
    expect(Object.keys(manifest.entries)).toEqual(hashed.map((e) => e.name));
    for (const e of hashed) expect(manifest.entries[e.name]).toEqual({ sha256: sha256(e.bytes), size: e.bytes.length });
    expect(manifest.bakes).toEqual({ routes: false, snapshots: false });
  });

  it('FR-FIL-003: document.json is the canonical document: it parses back to the same document', async () => {
    const entries = await entriesOf(doc);
    const back = parseDocument(decodeUtf8(bytesOf(entries, 'document.json')));
    expect(back.ok && back.value.document).toEqual(doc);
  });

  it('FR-FIL-003: the theme of the document is written as theme/tokens.json; a document without one has no such entry', async () => {
    const themed: DocumentFile = {
      ...doc,
      records: {
        ...doc.records,
        ['theme-x' as RecordId]: {
          id: 'theme-x' as RecordId,
          type: 'theme',
          name: 'X',
          tokens: { color: { $type: 'color', b: { $value: '#fff' }, a: { $value: '#000' } } },
        },
        ...Object.fromEntries(
          Object.entries(doc.records)
            .filter(([, r]) => r.type === 'document')
            .map(([id, r]) => [id, { ...r, themeId: 'theme-x' }]),
        ),
      },
    };
    const entries = await entriesOf(themed);
    const tokens = decodeUtf8(bytesOf(entries, 'theme/tokens.json'));
    expect(tokens.indexOf('"a"')).toBeLessThan(tokens.indexOf('"b"'));
    expect(entries.some((e) => e.name === 'theme/tokens.json')).toBe(true);
    expect((await entriesOf(doc)).some((e) => e.name === 'theme/tokens.json')).toBe(false);
  });

  it('FR-FIL-004: assets are written by the hash of their bytes, sorted, stored when already compressed; a wrong key is refused', async () => {
    const png = text('not really a png, but bytes');
    const svg = text('<svg xmlns="http://www.w3.org/2000/svg"/>');
    const assets = new Map([
      [sha256(svg), { bytes: svg, mime: 'image/svg+xml' }],
      [sha256(png), { bytes: png, mime: 'image/png' }],
    ]);
    const entries = await entriesOf(doc, { assets });
    const names = entries.filter((e) => e.name.startsWith('assets/')).map((e) => e.name);
    expect(names).toEqual([...names].sort());
    expect(names).toContain(`assets/${sha256(png)}.png`);
    expect(names).toContain(`assets/${sha256(svg)}.svg`);
    expect(entries.find((e) => e.name.endsWith('.png'))?.method).toBe('store');
    const unknown = new Map([[sha256(png), { bytes: png, mime: 'application/x-mystery' }]]);
    expect((await entriesOf(doc, { assets: unknown })).some((e) => e.name === `assets/${sha256(png)}.bin`)).toBe(true);
    const wrong = await writeFlux({ document: doc, appVersion: '1', hasher, assets: new Map([['0'.repeat(64), { bytes: png, mime: 'image/png' }]]) });
    expect(wrong.ok).toBe(false);
  });

  it('FR-FIL-003: the source and the preview are written when given and named in the manifest', async () => {
    const entries = await entriesOf(doc, { source: 'flux: 1\n', preview: text('RIFFxxxxWEBP') });
    expect(decodeUtf8(bytesOf(entries, 'source/document.flux.yaml'))).toBe('flux: 1\n');
    expect(entries.find((e) => e.name === 'preview.webp')?.method).toBe('store');
    const manifest = JSON.parse(decodeUtf8(bytesOf(entries, 'manifest.json'))) as { source: string; preview: string };
    expect(manifest).toMatchObject({ source: 'source/document.flux.yaml', preview: 'preview.webp' });
  });

  it('FR-FIL-003: a document with no times writes the fixed time, not a clock', async () => {
    const bare = fixtureDocument('minimal.flux.json');
    const manifest = JSON.parse(decodeUtf8(bytesOf(await entriesOf(bare), 'manifest.json'))) as { created: string; modified: string; title: string };
    expect(manifest).toMatchObject({ created: '1980-01-01T00:00:00.000Z', modified: '1980-01-01T00:00:00.000Z', title: 'Minimal' });
  });
});
