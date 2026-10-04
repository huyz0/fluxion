import { type DocumentFile, parseDocument, type RecordId } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { FLUX_MIMETYPE, writeFlux } from './flux-writer.js';
import { sha256 } from './testing/sha256.js';
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
