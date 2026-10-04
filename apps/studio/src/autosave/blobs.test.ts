import { describe, expect, it } from 'vitest';
import { getAssetBytes, pruneAssetBytes, putAssetBytes } from './asset-bytes.js';
import { type BlobStore, memoryBlobs } from './blobs.js';
import { listSnapshots, readSnapshot, SNAPSHOT_INTERVAL_MS, snapshotDue, VERSION_SNAPSHOTS, writeSnapshot } from './snapshots.js';

const bytes = (...n: number[]) => new Uint8Array(n);
const hash = (c: string) => c.repeat(64);
const at = (n: number) => new Date(Date.UTC(2026, 9, 4, 10, 0, 0, n)).toISOString();

/** A store that counts the writes it receives. */
function counting(inner: BlobStore): BlobStore & { puts: number } {
  const c = {
    puts: 0,
    put(p: string, b: Uint8Array) {
      c.puts += 1;
      return inner.put(p, b);
    },
    get: (p: string) => inner.get(p),
    list: (d: string) => inner.list(d),
    remove: (p: string) => inner.remove(p),
  };
  return c;
}

describe('version snapshots (FR-FIL-007)', () => {
  it('FR-FIL-007: after 25 writes exactly the newest 20 versions remain', async () => {
    const blobs = memoryBlobs();
    for (let i = 0; i < 25; i++) await writeSnapshot(blobs, 'doc', at(i), bytes(i));
    const kept = await listSnapshots(blobs, 'doc');
    expect(VERSION_SNAPSHOTS).toBe(20);
    expect(kept).toHaveLength(20);
    expect(kept[0]?.at).toBe(at(24));
    expect(kept.at(-1)?.at).toBe(at(5));
    expect(await readSnapshot(blobs, 'doc', kept[0]?.name ?? '')).toEqual(bytes(24));
  });

  it("FR-FIL-007: one document's versions never touch another's, even when their ids differ only by a character a path cannot hold", async () => {
    const blobs = memoryBlobs();
    for (let i = 0; i < 22; i++) await writeSnapshot(blobs, 'a/b', at(i), bytes(1));
    await writeSnapshot(blobs, 'a.b', at(0), bytes(2));
    expect(await listSnapshots(blobs, 'a/b')).toHaveLength(20);
    expect(await listSnapshots(blobs, 'a.b')).toHaveLength(1);
    expect(await listSnapshots(blobs, 'nothing')).toEqual([]);
  });

  it('FR-FIL-007: a time that is not an ISO instant with milliseconds is refused before anything is written', async () => {
    const blobs = memoryBlobs();
    await expect(writeSnapshot(blobs, 'doc', 'yesterday', bytes(1))).rejects.toThrow(RangeError);
    await expect(readSnapshot(blobs, 'doc', '../x')).rejects.toThrow(RangeError);
    expect(await listSnapshots(blobs, 'doc')).toEqual([]);
  });

  it('FR-FIL-007: a snapshot is due after ten minutes of editing with changes, not before and not without changes', () => {
    expect(snapshotDue(0, SNAPSHOT_INTERVAL_MS - 1, true)).toBe(false);
    expect(snapshotDue(0, SNAPSHOT_INTERVAL_MS, true)).toBe(true);
    expect(snapshotDue(0, SNAPSHOT_INTERVAL_MS * 3, false)).toBe(false);
  });
});

describe('asset bytes (FR-FIL-004, FR-FIL-007)', () => {
  it('FR-FIL-004: an asset is one file however many times it is put', async () => {
    const blobs = counting(memoryBlobs());
    await putAssetBytes(blobs, hash('a'), bytes(1, 2));
    await putAssetBytes(blobs, hash('a'), bytes(1, 2));
    await putAssetBytes(blobs, hash('a'), bytes(1, 2));
    expect(blobs.puts).toBe(1);
    expect(await getAssetBytes(blobs, hash('a'))).toEqual(bytes(1, 2));
    expect(await getAssetBytes(blobs, hash('b'))).toBeUndefined();
  });

  it('FR-FIL-004: only a sha256 names an asset, so no path can be smuggled in', async () => {
    const blobs = memoryBlobs();
    await expect(putAssetBytes(blobs, '../versions/x', bytes(1))).rejects.toThrow(RangeError);
    await expect(getAssetBytes(blobs, 'A'.repeat(64))).rejects.toThrow(RangeError);
  });

  it('FR-FIL-004: pruning drops the hashes no document uses and keeps the rest', async () => {
    const blobs = memoryBlobs();
    for (const c of 'abc') await putAssetBytes(blobs, hash(c), bytes(1));
    expect(await pruneAssetBytes(blobs, new Set([hash('b')]))).toBe(2);
    expect([...(await blobs.list('assets'))]).toEqual([hash('b')]);
  });

  it('FR-FIL-007: bytes handed to the store are copied, so changing them afterwards changes nothing kept', async () => {
    const blobs = memoryBlobs();
    const mine = bytes(1, 2, 3);
    await blobs.put('assets/x', mine);
    mine[0] = 9;
    expect(await blobs.get('assets/x')).toEqual(bytes(1, 2, 3));
  });
});
