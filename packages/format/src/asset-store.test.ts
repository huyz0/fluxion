import type { AnyRecord, DocumentFile, RecordId } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { createMemoryAssetStore, referencedAssetHashes, selectAssets } from './asset-store.js';
import { writeFlux } from './flux-writer.js';
import { sha256Hex as sha256 } from './sha256.js';
import { encodeUtf8 } from './utf8.js';

const hasher = { sha256: (bytes: Uint8Array) => Promise.resolve(sha256(bytes)) };
/** Bytes LZ77 cannot shrink. */
const noise = (n: number, seed = 1): Uint8Array => {
  let x = seed;
  return Uint8Array.from({ length: n }, () => {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    return x >>> 24;
  });
};
const id = (s: string) => s as RecordId;

/** A document with one screen, one image asset record for `bytes` and `copies` image elements that name it. */
async function documentWith(bytes: Uint8Array, copies: number): Promise<DocumentFile> {
  const hash = await hasher.sha256(bytes);
  const records: { [k: string]: AnyRecord } = {
    doc: { id: id('doc'), type: 'document', title: 'Assets' } as AnyRecord,
    screen: { id: id('screen'), type: 'screen', index: 'a0', name: 'S', size: { w: 1920, h: 1080 } } as AnyRecord,
    img: { id: id('img'), type: 'asset', hash, mime: 'image/png', size: bytes.length, name: 'p.png' } as AnyRecord,
  };
  for (let i = 0; i < copies; i++) {
    const eid = `el${i}`;
    records[eid] = {
      id: id(eid),
      type: 'element',
      kind: 'image',
      screenId: id('screen'),
      index: `a${i}`,
      assetId: id('img'),
      transform: { x: i * 10, y: 0, w: 100, h: 100 },
    } as AnyRecord;
  }
  return { schemaVersion: '1.2', records };
}

describe('the asset store', () => {
  it('FR-FIL-004: bytes put twice are held once under their hash, and can be read, listed and deleted', async () => {
    const store = createMemoryAssetStore(hasher);
    const a = await store.put(encodeUtf8('hello'), 'text/plain');
    const b = await store.put(encodeUtf8('hello'), 'text/plain');
    const c = await store.put(encodeUtf8('world'), 'text/plain');
    expect(a).toBe(b);
    expect(await store.hashes()).toEqual([a, c].sort());
    expect(await store.has(a)).toBe(true);
    expect((await store.get(a))?.mime).toBe('text/plain');
    await store.delete(a);
    await store.delete(a);
    expect(await store.has(a)).toBe(false);
    expect(await store.get(a)).toBeUndefined();
  });

  it('FR-FIL-004: the store keeps its own copy of the bytes it is given', async () => {
    const store = createMemoryAssetStore(hasher);
    const bytes = encodeUtf8('abc');
    const hash = await store.put(bytes, 'text/plain');
    bytes[0] = 0;
    expect(Array.from((await store.get(hash))?.bytes ?? [])).toEqual(Array.from(encodeUtf8('abc')));
  });
});

describe('referenced assets', () => {
  it('FR-FIL-004: an asset no record refers to is not saved, and one a record refers to is', async () => {
    const used = noise(300, 1);
    const unused = noise(300, 2);
    const doc = await documentWith(used, 1);
    const store = createMemoryAssetStore(hasher);
    const usedHash = await store.put(used, 'image/png');
    const unusedHash = await store.put(unused, 'image/png');
    expect(referencedAssetHashes(doc)).toEqual([usedHash]);
    const picked = await selectAssets(doc, store);
    expect([...picked.assets.keys()]).toEqual([usedHash]);
    expect(picked.missing).toEqual([]);
    // the unused one stays in the store, so undo still finds it
    expect(await store.has(unusedHash)).toBe(true);
  });

  it('FR-FIL-004: a referenced asset the store lacks is listed as missing, not a failure', async () => {
    const doc = await documentWith(noise(300), 2);
    const picked = await selectAssets(doc, createMemoryAssetStore(hasher));
    expect(picked.assets.size).toBe(0);
    expect(picked.missing).toEqual(referencedAssetHashes(doc));
  });

  it('FR-FIL-004: only the fields that name an asset count: a screen background and a fill do, an index or a name that equals an id does not', async () => {
    const doc = await documentWith(noise(50), 0);
    const hashOf = (c: string) => c.repeat(64);
    const asset = (rid: string, hash: string) => ({ id: id(rid), type: 'asset', hash, mime: 'image/png', size: 1, name: 'x.png' }) as AnyRecord;
    const records: { [k: string]: AnyRecord } = {
      ...doc.records,
      bg: asset('bg', hashOf('b')),
      fill: asset('fill', hashOf('c')),
      a1: asset('a1', hashOf('d')),
      snap: asset('snap', hashOf('e')),
      screen: { ...(Object.values(doc.records).find((r) => r.type === 'screen') as object), background: { assetId: id('bg') }, name: 'a1' } as AnyRecord,
      e1: {
        id: id('e1'),
        type: 'element',
        kind: 'shape',
        screenId: id('screen'),
        index: 'a1',
        defId: 'basic:rect',
        style: { fill: { assetId: id('fill') } },
        transform: { x: 0, y: 0, w: 1, h: 1 },
      } as AnyRecord,
      e2: { id: id('e2'), type: 'element', kind: 'component', screenId: id('screen'), index: 'a2', snapshotAssetId: id('snap') } as AnyRecord,
    };
    expect(referencedAssetHashes({ ...doc, records })).toEqual([hashOf('b'), hashOf('c'), hashOf('e')]);
  });

  it('FR-FIL-004: with no theme record to read the defaults from, every font asset is kept', async () => {
    const doc = await documentWith(noise(50), 0);
    const withFont: DocumentFile = {
      ...doc,
      records: {
        ...doc.records,
        font: { id: id('font'), type: 'asset', hash: 'f'.repeat(64), mime: 'font/woff2', size: 1, name: 'x.woff2', font: { family: 'X' } } as AnyRecord,
      },
    };
    expect(referencedAssetHashes(withFont)).toEqual(['f'.repeat(64)]);
  });

  it('FR-FIL-004: duplicating an image 10 times adds less than 1 kB', async () => {
    const bytes = noise(20_000);
    const store = createMemoryAssetStore(hasher);
    await store.put(bytes, 'image/png');
    const size = async (copies: number) => {
      const doc = await documentWith(bytes, copies);
      const picked = await selectAssets(doc, store);
      const zip = await writeFlux({ document: doc, assets: picked.assets, appVersion: '0', hasher });
      if (!zip.ok) throw new Error(zip.error.reason);
      return zip.value.length;
    };
    const one = await size(1);
    const eleven = await size(11);
    expect(eleven - one).toBeLessThan(1024);
    expect(one).toBeGreaterThan(20_000);
  });
});
