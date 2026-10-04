import { type DocumentFile, parseDocument } from '@fluxion/schema';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FLUX_MIMETYPE, writeFlux } from './flux-writer.js';
import { loadFlux } from './loader.js';
import { sha256Hex as sha256 } from './sha256.js';
import { encodeUtf8 } from './utf8.js';
import { writeZip, type ZipInput } from './zip.js';

declare global {
  interface ImportMeta {
    /** Vite's build-time glob import. */
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}

const FIXTURES = import.meta.glob('../../../fixtures/docs/{minimal,two-rects-line}.flux.json', { query: '?raw', import: 'default', eager: true });
const fixtureDocument = (name: string): DocumentFile => {
  const text = Object.entries(FIXTURES).find(([path]) => path.endsWith(name))?.[1] ?? '';
  const parsed = parseDocument(text);
  if (!parsed.ok) throw new Error(`fixture ${name} does not parse`);
  return parsed.value.document;
};
const hasher = { sha256: (bytes: Uint8Array) => Promise.resolve(sha256(bytes)) };
const text = (s: string) => encodeUtf8(s);
const png = text('pretend png bytes');

/** A valid `.flux` of the two-rects fixture with one asset. */
async function validFile(): Promise<Uint8Array> {
  const assets = new Map([[sha256(png), { bytes: png, mime: 'image/png' }]]);
  const zip = await writeFlux({ document: fixtureDocument('two-rects-line.flux.json'), assets, appVersion: '0', hasher });
  if (!zip.ok) throw new Error(zip.error.reason);
  return zip.value;
}
const zipOf = (entries: ZipInput[]): Uint8Array => {
  const zip = writeZip(entries);
  if (!zip.ok) throw new Error(zip.error.reason);
  return zip.value;
};
const MIME: ZipInput = { name: 'mimetype', bytes: text(FLUX_MIMETYPE), method: 'store' };
const DOC = (): ZipInput => ({
  name: 'document.json',
  bytes: text('{"schemaVersion":"1.2","records":{"AAAAAAAAAAAAAAAA":{"id":"AAAAAAAAAAAAAAAA","type":"document"}}}'),
});
const code = async (bytes: Uint8Array, limits?: Parameters<typeof loadFlux>[1]['limits']) => {
  const r = await loadFlux(bytes, { hasher, ...(limits ? { limits } : {}) });
  return r.ok ? 'ok' : r.error.code;
};

type Edit =
  | { readonly kind: 'flip'; readonly at: number; readonly by: number }
  | { readonly kind: 'cut'; readonly at: number }
  | { readonly kind: 'splice'; readonly at: number; readonly data: Uint8Array };
/** `bytes` with one edit applied: a byte flipped, the end cut off, or bytes spliced in. */
function applyEdit(bytes: Uint8Array, e: Edit): Uint8Array {
  if (e.kind === 'cut') return bytes.slice(0, e.at);
  if (e.kind === 'splice') return Uint8Array.from([...bytes.subarray(0, e.at), ...e.data, ...bytes.subarray(e.at)]);
  const out = bytes.slice();
  if (e.at < out.length) out[e.at] = (out[e.at] as number) ^ e.by;
  return out;
}

describe('loadFlux', () => {
  it('FR-FIL-009: a file the writer made opens as the same document with its assets and no notes', async () => {
    const r = await loadFlux(await validFile(), { hasher });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.document).toEqual(fixtureDocument('two-rects-line.flux.json'));
    expect(r.value.notes).toEqual([]);
    expect([...r.value.assets.keys()]).toEqual([sha256(png)]);
    expect(r.value.assets.get(sha256(png))?.mime).toBe('image/png');
  });

  it('FR-FIL-009: what is not a .flux is refused with a code: text, a zip without the mimetype, a zip without a document', async () => {
    expect(await code(text('hello, not a zip at all'))).toBe('FILE_NOT_FLUX');
    expect(await code(new Uint8Array(0))).toBe('FILE_NOT_FLUX');
    expect(await code(zipOf([{ name: 'a.txt', bytes: text('x') }]))).toBe('FILE_NOT_FLUX');
    expect(await code(zipOf([{ name: 'mimetype', bytes: text('application/zip'), method: 'store' }, DOC()]))).toBe('FILE_NOT_FLUX');
    expect(await code(zipOf([MIME, { name: 'manifest.json', bytes: text('{}') }]))).toBe('FILE_DOCUMENT_MISSING');
    expect(await code(zipOf([MIME, { name: 'document.json', bytes: text('{not json') }]))).toBe('FILE_DOCUMENT_INVALID');
    expect(await code(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))).toBe('FILE_ZIP_INVALID');
  });

  it("FR-FIL-009: through loadFlux, a cut document.json opens in part with the manifest's version, and a newer major opens read-only", async () => {
    const gallery = fixtureDocument('two-rects-line.flux.json');
    const records = Object.values(gallery.records);
    const whole = JSON.stringify({ records: Object.fromEntries(records.map((r) => [r.id, r])), schemaVersion: gallery.schemaVersion });
    const cut = whole.slice(0, whole.length - 60);
    const manifest = (schemaVersion: string): ZipInput => ({ name: 'manifest.json', bytes: text(JSON.stringify({ schemaVersion, entries: {} })) });
    const open = (docText: string, version: string) => loadFlux(zipOf([MIME, manifest(version), { name: 'document.json', bytes: text(docText) }]), { hasher });
    const partial = await open(cut, gallery.schemaVersion);
    expect(partial.ok && partial.value).toMatchObject({ readOnly: false, salvage: { reason: 'truncated' } });
    expect(partial.ok && Object.keys(partial.value.document.records).length).toBeGreaterThan(0);
    // no manifest version: the cut text names none either, so the records are read as the current version and the file is read-only
    const unversioned = await loadFlux(zipOf([MIME, { name: 'document.json', bytes: text(cut) }]), { hasher });
    expect(unversioned.ok && unversioned.value).toMatchObject({ readOnly: true, salvage: { reason: 'truncated', versionGuessed: true } });
    const newer = await open(whole.replace(`"schemaVersion":"${gallery.schemaVersion}"`, '"schemaVersion":"2.0"'), '2.0');
    expect(newer.ok && newer.value).toMatchObject({ readOnly: true, salvage: { reason: 'newer-major' } });
    const normal = await loadFlux(await validFile(), { hasher });
    expect(normal.ok && normal.value.readOnly).toBe(false);
    expect(normal.ok && normal.value.salvage).toBeUndefined();
  });

  it('FR-FIL-009: an archive over the expansion limit is refused, not unpacked', async () => {
    const file = await validFile();
    expect(await code(file, { maxEntryBytes: 100 })).toBe('FILE_TOO_LARGE');
    expect(await code(file, { maxTotalBytes: 100 })).toBe('FILE_TOO_LARGE');
    expect(await code(file, { maxEntries: 1 })).toBe('FILE_TOO_LARGE');
    // a stream that inflates past the size it declares is stopped at the declared size
    const big = zipOf([MIME, { name: 'document.json', bytes: new Uint8Array(200_000).fill(32) }]);
    const view = new DataView(big.buffer, big.byteOffset, big.byteLength);
    const central = view.getUint32(big.length - 22 + 16, true);
    // the second central record's declared size: shrink it to 1 000 bytes
    let at = central;
    at += 46 + view.getUint16(at + 28, true);
    view.setUint32(at + 24, 1000, true);
    expect(await code(big)).toBe('FILE_TOO_LARGE');
  });

  it('FR-FIL-009: entries with .., absolute or duplicate paths are refused', async () => {
    for (const name of ['../evil.json', 'a/../../evil', '/etc/passwd', 'C:/x', 'a\\b', './x', 'a/./b', 'a\u0001b']) {
      expect(await code(zipOf([MIME, DOC(), { name, bytes: text('x') }])), name).toBe('FILE_PATH_UNSAFE');
    }
    expect(await code(zipOf([MIME, DOC(), { name: 'x', bytes: text('1') }, { name: 'x', bytes: text('2') }]))).toBe('FILE_PATH_UNSAFE');
  });

  it('FR-FIL-009: names that are one path on a case-insensitive or normalising file system are refused, and so are empty segments and DEL', async () => {
    const pairs: [string, string][] = [
      ['Document.json', 'document.json'],
      ['assets/a.PNG', 'assets/a.png'],
      ['caf\u00e9', 'cafe\u0301'],
      ['a', 'a/'],
    ];
    for (const [one, two] of pairs) {
      expect(await code(zipOf([MIME, DOC(), { name: one, bytes: text('1') }, { name: two, bytes: text('2') }])), `${one} ${two}`).toBe('FILE_PATH_UNSAFE');
    }
    for (const name of ['a//b', 'a\u007fb']) expect(await code(zipOf([MIME, DOC(), { name, bytes: text('x') }])), name).toBe('FILE_PATH_UNSAFE');
    // a directory entry on its own is fine
    expect(await code(zipOf([MIME, DOC(), { name: 'assets/', bytes: new Uint8Array(0) }]))).toBe('ok');
  });

  it('FR-FIL-009: a damaged container opens with notes: a wrong hash, an unlisted or missing entry, a bad asset, no manifest, mimetype not first', async () => {
    const doc = DOC();
    const manifest = (entries: object) => ({ name: 'manifest.json', bytes: text(JSON.stringify({ entries })) });
    const notesOf = async (entries: ZipInput[]) => {
      const r = await loadFlux(zipOf(entries), { hasher });
      if (!r.ok) throw new Error(r.error.message);
      return r.value.notes.map((n) => `${n.code} ${n.entry}`);
    };
    expect(await notesOf([MIME, doc])).toEqual(['MANIFEST_MISSING manifest.json']);
    expect(await notesOf([MIME, { name: 'manifest.json', bytes: text('[1,') }, doc])).toEqual(
      ['MANIFEST_INVALID manifest.json', 'ENTRY_UNLISTED document.json'].slice(0, 1),
    );
    expect(await notesOf([doc, MIME, manifest({ 'document.json': { sha256: sha256(doc.bytes) } })])).toEqual(['MIMETYPE_NOT_FIRST mimetype']);
    expect(await notesOf([MIME, manifest({ 'document.json': { sha256: '0'.repeat(64) }, 'gone.json': { sha256: 'x' } }), doc])).toEqual([
      'ENTRY_HASH_MISMATCH document.json',
      'ENTRY_MISSING gone.json',
    ]);
    expect(await notesOf([MIME, manifest({}), doc, { name: 'extra.txt', bytes: text('x') }])).toEqual([
      'ENTRY_UNLISTED document.json',
      'ENTRY_UNLISTED extra.txt',
    ]);
    const wrongBytes = { name: `assets/${'a'.repeat(64)}.png`, bytes: png };
    const oddName = { name: 'assets/readme.txt', bytes: text('x') };
    const listed = manifest({
      'document.json': { sha256: sha256(doc.bytes) },
      [wrongBytes.name]: { sha256: sha256(png) },
      [oddName.name]: { sha256: sha256(oddName.bytes) },
    });
    expect(await notesOf([MIME, listed, doc, oddName, wrongBytes])).toEqual(['ASSET_NAME_INVALID assets/readme.txt', `ASSET_HASH_MISMATCH ${wrongBytes.name}`]);
    // an asset with an extension the loader does not know is kept as octet-stream
    const odd = { name: `assets/${sha256(png)}.xyz`, bytes: png };
    const r = await loadFlux(zipOf([MIME, doc, odd]), { hasher });
    expect(r.ok && r.value.assets.get(sha256(png))?.mime).toBe('application/octet-stream');
  });

  it('NFR-REL-002: the loader never throws on a corrupted zip (10000 runs)', async () => {
    const base = await validFile();
    const damage = fc.oneof(
      fc.record({ kind: fc.constant('flip' as const), at: fc.nat(base.length - 1), by: fc.integer({ min: 1, max: 255 }) }),
      fc.record({ kind: fc.constant('cut' as const), at: fc.nat(base.length) }),
      fc.record({ kind: fc.constant('splice' as const), at: fc.nat(base.length), data: fc.uint8Array({ maxLength: 40 }) }),
    );
    await fc.assert(
      fc.asyncProperty(fc.array(damage, { minLength: 1, maxLength: 4 }), async (edits) => {
        const r = await loadFlux(edits.reduce(applyEdit, base), { hasher });
        // FILE_INTERNAL is the catch-all for an exception: seeing it means the loader threw on this input
        return r.ok || r.error.code !== 'FILE_INTERNAL';
      }),
      { numRuns: 10000 },
    );
    // the stages after the zip, reached with damaged but unpackable content: arbitrary names, manifests, mimetypes and document bytes
    const entry = fc.record({
      name: fc.oneof(
        fc.constantFrom('document.json', 'manifest.json', 'mimetype', 'theme/tokens.json', `assets/${sha256(png)}.png`, 'assets/x', '../x', 'a/'),
        fc.string({ maxLength: 12 }),
      ),
      bytes: fc.oneof(fc.uint8Array({ maxLength: 80 }), fc.json().map(text), fc.constant(text(FLUX_MIMETYPE)), fc.constant(png), fc.constant(DOC().bytes)),
      method: fc.constantFrom('store' as const, 'deflate' as const),
    });
    await fc.assert(
      fc.asyncProperty(fc.array(entry, { maxLength: 6 }), async (entries) => {
        const zip = writeZip([MIME, ...entries]);
        if (!zip.ok) return true;
        const r = await loadFlux(zip.value, { hasher });
        return r.ok || r.error.code !== 'FILE_INTERNAL';
      }),
      { numRuns: 10000 },
    );
  }, 120_000);
});
