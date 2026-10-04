import { afterEach, describe, expect, it } from 'vitest';
import { putAssetBytes } from './asset-bytes.js';
import { type BlobStore, opfsBlobs } from './blobs.js';
import { idbAutosaveStore } from './idb-store.js';
import { listSnapshots, VERSION_SNAPSHOTS, writeSnapshot } from './snapshots.js';

const bytes = (...n: number[]) => new Uint8Array(n);
const closers: (() => void)[] = [];
let counter = 0;
afterEach(() => {
  for (const c of closers.splice(0)) c();
});

async function opfs(): Promise<BlobStore> {
  counter += 1;
  const root = await navigator.storage.getDirectory();
  return opfsBlobs(await root.getDirectoryHandle(`test-${Date.now()}-${counter}`, { create: true }));
}
async function idb(): Promise<BlobStore> {
  counter += 1;
  const store = await idbAutosaveStore(indexedDB, `fluxion-blobs-test-${Date.now()}-${counter}`);
  closers.push(() => store.close());
  return store.blobs;
}

describe.each([
  ['OPFS', opfs],
  ['the assets object store', idb],
])('the byte store on %s (FR-FIL-004, FR-FIL-007)', (_name, make) => {
  it('FR-FIL-007: bytes put are read back whole, replaced by a second put, listed by directory and removed', async () => {
    const blobs = await make();
    expect(await blobs.get('assets/missing')).toBeUndefined();
    expect(await blobs.list('assets')).toEqual([]);
    await blobs.put('assets/one', bytes(1, 2, 3));
    await blobs.put('assets/two', bytes(4));
    await blobs.put('versions/d/x.flux', bytes(5));
    await blobs.put('assets/one', bytes(9, 9));
    expect(await blobs.get('assets/one')).toEqual(bytes(9, 9));
    expect([...(await blobs.list('assets'))].sort()).toEqual(['one', 'two']);
    expect([...(await blobs.list('versions'))]).toEqual(['d']);
    await blobs.remove('assets/one');
    await blobs.remove('assets/one');
    expect(await blobs.get('assets/one')).toBeUndefined();
  });

  it('FR-FIL-004: a path an adapter could misread is refused', async () => {
    const blobs = await make();
    await expect(blobs.put('../escape', bytes(1))).rejects.toThrow(RangeError);
    await expect(blobs.get('a//b')).rejects.toThrow(RangeError);
  });

  it('FR-FIL-007: 25 snapshot writes keep 20 and an asset put twice is one file', async () => {
    const blobs = await make();
    for (let i = 0; i < 25; i++) await writeSnapshot(blobs, 'doc', new Date(Date.UTC(2026, 0, 1, 0, 0, 0, i)).toISOString(), bytes(i));
    expect(await listSnapshots(blobs, 'doc')).toHaveLength(VERSION_SNAPSHOTS);
    const hash = 'f'.repeat(64);
    await putAssetBytes(blobs, hash, bytes(1));
    await putAssetBytes(blobs, hash, bytes(1));
    expect(await blobs.list('assets')).toEqual([hash]);
  });
});
