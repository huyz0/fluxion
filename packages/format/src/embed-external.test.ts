import type { CoreError } from '@fluxion/core';
import { type AnyRecord, type DocumentFile, err, ok, type RecordId } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { createMemoryAssetStore, selectAssets } from './asset-store.js';
import { embedExternalAssets, UNPINNED_HASH } from './embed-external.js';
import { writeFlux } from './flux-writer.js';
import { sha256Hex as sha256 } from './sha256.js';
import { decodeUtf8, encodeUtf8 } from './utf8.js';

const hasher = { sha256: (bytes: Uint8Array) => Promise.resolve(sha256(bytes)) };
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const text = (s: string) => [...s].map((c) => c.charCodeAt(0));
/** A PNG header of `w` x `h`: enough for the sniffer. */
const png = (w: number, h: number, tag = 0): Uint8Array =>
  Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), ...text('IHDR'), ...be32(w), ...be32(h), 8, 6, 0, 0, 0, 0, 0, 0, tag]);
const id = (s: string) => s as RecordId;

/** Asset records for `sources` (record id to [url, pinned hash]) and one screen. */
function documentWith(sources: { [recordId: string]: readonly [string, string] }): DocumentFile {
  const records: { [k: string]: AnyRecord } = {
    doc: { id: id('doc'), type: 'document', title: 'External' } as AnyRecord,
    screen: { id: id('screen'), type: 'screen', index: 'a0', name: 'S', size: { w: 1920, h: 1080 } } as AnyRecord,
  };
  let i = 0;
  for (const [rid, [source, hash]] of Object.entries(sources)) {
    records[rid] = { id: id(rid), type: 'asset', hash, mime: 'image/png', size: 0, name: 'p.png', source } as AnyRecord;
    records[`el-${rid}`] = {
      id: id(`el-${rid}`),
      type: 'element',
      kind: 'image',
      screenId: id('screen'),
      index: `a${i++}`,
      assetId: id(rid),
      transform: { x: 0, y: 0, w: 100, h: 100 },
    } as AnyRecord;
  }
  return { schemaVersion: '1.2', records };
}

/** A port serving `files` by URL, and counting reads. */
function serving(files: { [url: string]: Uint8Array }) {
  const reads: string[] = [];
  const io = {
    read: (path: string) => {
      reads.push(path);
      const bytes = files[path];
      return Promise.resolve(bytes === undefined ? err<CoreError>({ code: 'FILE_NOT_FOUND', message: path } as CoreError) : ok(bytes));
    },
  };
  return { io, reads };
}

const recordOf = (doc: DocumentFile, rid: string) => doc.records[rid] as unknown as { hash: string; size: number; mime: string; w?: number; source?: string };

describe('embedding external assets on save (FR-AST-006)', () => {
  it('FR-AST-006: an external image is fetched, kept by its hash, and its record holds the bytes and no source', async () => {
    const bytes = png(40, 30);
    const { io } = serving({ 'https://cdn.example/a.png': bytes });
    const store = createMemoryAssetStore(hasher);
    const r = await embedExternalAssets({ document: documentWith({ a: ['https://cdn.example/a.png', UNPINNED_HASH] }), store, io, hasher });
    expect(r.failures).toEqual([]);
    expect(r.embedded).toEqual(['a']);
    const rec = recordOf(r.document, 'a');
    expect(rec).toMatchObject({ hash: sha256(bytes), size: bytes.length, mime: 'image/png' });
    expect(rec.source).toBeUndefined();
    expect(await store.has(sha256(bytes))).toBe(true);
  });

  it('FR-AST-006: the same bytes behind two URLs are one stored asset and two records with one hash', async () => {
    const bytes = png(8, 8);
    const { io } = serving({ 'https://x.example/1.png': bytes, 'https://y.example/2.png': bytes });
    const store = createMemoryAssetStore(hasher);
    const r = await embedExternalAssets({
      document: documentWith({ a: ['https://x.example/1.png', UNPINNED_HASH], b: ['https://y.example/2.png', UNPINNED_HASH] }),
      store,
      io,
      hasher,
    });
    expect(await store.hashes()).toEqual([sha256(bytes)]);
    expect(recordOf(r.document, 'a').hash).toBe(recordOf(r.document, 'b').hash);
  });

  it('FR-AST-006: a pinned hash that the bytes do not match is EMBED_INTEGRITY, and the record stays external', async () => {
    const { io } = serving({ 'https://cdn.example/a.png': png(4, 4) });
    const doc = documentWith({ a: ['https://cdn.example/a.png', 'a'.repeat(64)] });
    const r = await embedExternalAssets({ document: doc, store: createMemoryAssetStore(hasher), io, hasher });
    expect(r.failures).toMatchObject([{ id: 'a', code: 'EMBED_INTEGRITY' }]);
    expect(recordOf(r.document, 'a').source).toBe('https://cdn.example/a.png');
  });

  it('FR-AST-006: a pinned hash that the bytes match embeds', async () => {
    const bytes = png(4, 4, 9);
    const { io } = serving({ 'https://cdn.example/a.png': bytes });
    const r = await embedExternalAssets({
      document: documentWith({ a: ['https://cdn.example/a.png', sha256(bytes)] }),
      store: createMemoryAssetStore(hasher),
      io,
      hasher,
    });
    expect(r.failures).toEqual([]);
  });

  it('FR-AST-006: a fetch that fails, a URL that is not http(s) and bytes that are not an image each name their code and leave the rest embedding', async () => {
    const { io, reads } = serving({ 'https://ok.example/a.png': png(2, 2), 'https://bad.example/x.png': encodeUtf8('<html>not an image</html>') });
    const doc = documentWith({
      ok: ['https://ok.example/a.png', UNPINNED_HASH],
      gone: ['https://gone.example/a.png', UNPINNED_HASH],
      file: ['file:///etc/passwd', UNPINNED_HASH],
      js: ['javascript:alert(1)', UNPINNED_HASH],
      html: ['https://bad.example/x.png', UNPINNED_HASH],
    });
    const r = await embedExternalAssets({ document: doc, store: createMemoryAssetStore(hasher), io, hasher });
    expect(r.embedded).toEqual(['ok']);
    expect(Object.fromEntries(r.failures.map((f) => [f.id, f.code]))).toEqual({
      gone: 'EMBED_FETCH_FAILED',
      file: 'EMBED_URL_REFUSED',
      js: 'EMBED_URL_REFUSED',
      html: 'EMBED_NOT_AN_IMAGE',
    });
    // a refused URL is never handed to the port
    expect(reads).not.toContain('file:///etc/passwd');
    expect(reads).not.toContain('javascript:alert(1)');
  });

  it('FR-AST-006: only https addresses of public hosts are fetched; plain http, loopback, private networks and credentials are refused unread', async () => {
    const refused = [
      'http://cdn.example/a.png',
      'https://localhost/a.png',
      'https://127.0.0.1/a.png',
      'https://10.0.0.5/a.png',
      'https://192.168.1.1/a.png',
      'https://172.20.0.1/a.png',
      'https://169.254.169.254/latest',
      'https://[::1]/a.png',
      'https://printer.local/a.png',
      'https://user:pw@cdn.example/a.png',
      'file:///etc/passwd',
    ];
    const { io, reads } = serving({});
    const r = await embedExternalAssets({
      document: documentWith(Object.fromEntries(refused.map((u, i) => [`r${i}`, [u, UNPINNED_HASH] as const]))),
      store: createMemoryAssetStore(hasher),
      io,
      hasher,
    });
    expect(r.failures.map((f) => f.code)).toEqual(refused.map(() => 'EMBED_URL_REFUSED'));
    expect(reads).toEqual([]);
  });

  it('FR-AST-006: an SVG is sanitised before it is kept', async () => {
    const svg = encodeUtf8('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><script>alert(1)</script><rect width="4" height="4"/></svg>');
    const { io } = serving({ 'https://cdn.example/a.svg': svg });
    const store = createMemoryAssetStore(hasher);
    const r = await embedExternalAssets({ document: documentWith({ a: ['https://cdn.example/a.svg', UNPINNED_HASH] }), store, io, hasher });
    expect(r.failures).toEqual([]);
    const kept = await store.get(recordOf(r.document, 'a').hash);
    expect(decodeUtf8(kept?.bytes ?? new Uint8Array())).not.toContain('script');
  });

  it('FR-AST-006: an SVG the sanitizer refuses stays external as EMBED_NOT_AN_IMAGE', async () => {
    const svg = encodeUtf8(`<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4">${'x'.repeat(2 * 1024 * 1024 + 1)}</svg>`);
    const { io } = serving({ 'https://cdn.example/a.svg': svg });
    const r = await embedExternalAssets({
      document: documentWith({ a: ['https://cdn.example/a.svg', UNPINNED_HASH] }),
      store: createMemoryAssetStore(hasher),
      io,
      hasher,
    });
    expect(r.failures.map((f) => f.code)).toEqual(['EMBED_NOT_AN_IMAGE']);
    expect(recordOf(r.document, 'a').source).toBe('https://cdn.example/a.svg');
  });

  it('FR-AST-006: records that already hold bytes are left alone, and the embedded document saves with the bytes and no network', async () => {
    const bytes = png(16, 16, 3);
    const { io, reads } = serving({ 'https://cdn.example/a.png': bytes });
    const store = createMemoryAssetStore(hasher);
    const r = await embedExternalAssets({ document: documentWith({ a: ['https://cdn.example/a.png', UNPINNED_HASH] }), store, io, hasher });
    const again = await embedExternalAssets({ document: r.document, store, io, hasher });
    expect(again.embedded).toEqual([]);
    expect(reads).toHaveLength(1);
    const picked = await selectAssets(r.document, store);
    expect(picked.missing).toEqual([]);
    const written = await writeFlux({ document: r.document, assets: picked.assets, appVersion: 'test', hasher });
    expect(written.ok).toBe(true);
    expect(JSON.stringify(r.document)).not.toContain('cdn.example');
  });
});
