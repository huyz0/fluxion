// Redrawing pictures when an asset record changes (FR-AST-005, M10.16): an image element names its asset by id, so a replaced picture (or an undone
// replace) changes no element and no view would read the bytes again. This counts the commits that put or delete an asset record; the editor makes
// its asset URL function anew when the count moves, which is what redraws the pictures, and only then.
import type { Store } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { useMemo, useRef, useSyncExternalStore } from 'react';
import { type AssetStore, createAssetStore } from './asset-store.js';

/**
 * How many commits so far touched an asset record of `store`.
 *
 * @public
 */
export function useAssetRevision(store: Store): number {
  const count = useRef(0);
  const subscribe = useMemo(
    () => (changed: () => void) =>
      store.subscribe((diff) => {
        const touched = [...diff.puts.values()].some((p) => p.after.type === 'asset') || [...diff.deletes.values()].some((r) => r.type === 'asset');
        if (!touched) return;
        count.current += 1;
        changed();
      }),
    [store],
  );
  return useSyncExternalStore(subscribe, () => count.current);
}

/**
 * The asset store of an editor and the function the views read picture URLs with. The store is the host's, or a new one; it is told how to read
 * a record's hash from `store`, so a replaced picture is found by the hash its record has now. The function is new whenever an asset record
 * changes, which is what makes the pictures read their bytes again.
 *
 * @public
 */
export function useEditorAssets(
  store: Store,
  given: AssetStore | undefined,
): { readonly assets: AssetStore; readonly url: (id: RecordId) => string | undefined } {
  const assets = useMemo(() => {
    const held = given ?? createAssetStore();
    held.bind((id) => (store.get(id) as { readonly hash?: string } | undefined)?.hash);
    return held;
  }, [given, store]);
  const revision = useAssetRevision(store);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `revision` is what makes the function new
  const url = useMemo(() => (id: RecordId) => assets.url(id), [assets, revision]);
  return { assets, url };
}
