// The bytes of the assets an open editor holds (FR-EDT-007, M7.23): the document keeps an asset's record, the host its
// bytes (ADR-0020), and until the asset store of the file format (M10) the editor keeps them itself, as `data:` URLs
// by asset id, for the views to draw (`AssetUrls`) and for a copy to carry (≤ 1 MB: ADR-0020).
import type { RecordId } from '@fluxion/schema';

/**
 * The asset bytes an editor holds, by asset id.
 *
 * @public
 */
export type AssetStore = {
  /** Hold `dataUrl` as the bytes of `id`. */
  set(id: RecordId, dataUrl: string): void;
  /** The bytes of `id` as a `data:` URL, if held. */
  url(id: RecordId): string | undefined;
};

/**
 * An empty asset store.
 *
 * @public
 */
export function createAssetStore(): AssetStore {
  const held = new Map<RecordId, string>();
  return {
    set: (id, dataUrl) => {
      held.set(id, dataUrl);
    },
    url: (id) => held.get(id),
  };
}
