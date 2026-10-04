// The bytes the editor holds for an asset record (FR-FIL-004): read back from the object URL the asset store serves them at.
import type { AssetStore } from '@fluxion/editor';
import type { FluxAsset } from '@fluxion/format';
import type { RecordId } from '@fluxion/schema';

/**
 * The bytes the editor holds for an asset record, as a file the writer can take.
 *
 * @public
 */
export async function heldBytes(assets: AssetStore, assetId: string): Promise<FluxAsset | undefined> {
  const url = assets.url(assetId as RecordId);
  if (url === undefined) return undefined;
  const blob = await (await fetch(url)).blob();
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type };
}
