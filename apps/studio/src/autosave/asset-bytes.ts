// Asset bytes in the autosave (FR-FIL-004, FR-FIL-007): content-addressed, so an asset that many records name is one file and a second put of the
// same hash writes nothing. A recovered document needs the bytes its records name; they were never in the journal.
import type { BlobStore } from './blobs.js';

const HASH = /^[0-9a-f]{64}$/;

function path(hash: string): string {
  if (!HASH.test(hash)) throw new RangeError(`not a sha256 hash: ${hash}`);
  return `assets/${hash}`;
}

/**
 * Keep `bytes` under `hash` (their sha256, lower-case hex); resolves without writing when they are already kept.
 *
 * @public
 */
export async function putAssetBytes(blobs: BlobStore, hash: string, bytes: Uint8Array): Promise<void> {
  const where = path(hash);
  if ((await blobs.get(where)) !== undefined) return;
  await blobs.put(where, bytes);
}

/**
 * The bytes kept under `hash`, or undefined.
 *
 * @public
 */
export async function getAssetBytes(blobs: BlobStore, hash: string): Promise<Uint8Array | undefined> {
  return blobs.get(path(hash));
}

/**
 * Drop every kept asset whose hash is not in `used`: the documents' referenced hashes, so a removed image does not stay in storage for ever.
 * Returns how many were dropped.
 *
 * @public
 */
export async function pruneAssetBytes(blobs: BlobStore, used: ReadonlySet<string>): Promise<number> {
  let dropped = 0;
  for (const name of await blobs.list('assets')) {
    if (!HASH.test(name) || used.has(name)) continue;
    await blobs.remove(`assets/${name}`);
    dropped += 1;
  }
  return dropped;
}
