// The bytes of the assets an open editor holds (FR-EDT-007, M7.23): the document keeps an asset's record, the host its
// bytes (ADR-0020), and until the asset store of the file format (M10) the editor keeps them itself, as `data:` URLs
// by asset id, for the views to draw (`AssetUrls`) and for a copy to carry (≤ 1 MB: ADR-0020).
import type { RecordId } from '@fluxion/schema';

/**
 * The asset bytes an editor holds: by asset id, and by the hash the record carried when the bytes were put (a replaced picture, undone,
 * shows the old bytes again, because the record's hash is what picks them).
 *
 * @public
 */
export type AssetStore = {
  /** Hold `dataUrl` as the bytes of `id`, whatever its record's hash (what a paste does, and what an undone replace falls back to). */
  set(id: RecordId, dataUrl: string): void;
  /** Hold `dataUrl` as the bytes of `id` while its record's hash is `hash`. */
  put(id: RecordId, hash: string, dataUrl: string): void;
  /** Tell the store how to read the hash of an asset's record (the editor binds the open document's; the last one bound is used). */
  bind(hashOf: (id: RecordId) => string | undefined): void;
  /** The bytes of `id` as a `data:` URL, if held: those put under its record's current hash, else those set for it. */
  url(id: RecordId): string | undefined;
};

/**
 * An empty asset store. `initial` tells the hash of an asset's record at this moment; the editor binds the open document's when it mounts,
 * and without one only what `set` holds is found.
 *
 * @public
 */
export function createAssetStore(initial?: (id: RecordId) => string | undefined): AssetStore {
  let hashOf = initial;
  const held = new Map<RecordId, string>();
  const byHash = new Map<RecordId, Map<string, string>>();
  return {
    set: (id, dataUrl) => {
      held.set(id, dataUrl);
    },
    put: (id, hash, dataUrl) => {
      const versions = byHash.get(id) ?? new Map<string, string>();
      versions.set(hash, dataUrl);
      byHash.set(id, versions);
    },
    bind: (resolver) => {
      hashOf = resolver;
    },
    url: (id) => {
      const hash = hashOf?.(id);
      return (hash === undefined ? undefined : byHash.get(id)?.get(hash)) ?? held.get(id);
    },
  };
}
