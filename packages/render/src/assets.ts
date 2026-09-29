// Image assets for views (FR-SHP-004, FR-SHP-012): the host resolves an asset id to a URL it can draw
// (a data or blob URL of bytes it holds; M5 hosts pass in-memory assets). Nothing else is drawn: an
// asset's external `source` never is, so a page never fetches on its own (NFR-PORT-002, M5.13 review).
import type { Store } from '@fluxion/core';
import type { AssetRecord, RecordId } from '@fluxion/schema';
import { type Context, createContext, useContext, useMemo } from 'react';
import { useValue } from './use-value.js';

/**
 * The URL a host draws an asset from, by asset id; undefined when it has none. Keep it stable (for
 * example with `useCallback`): a new function re-renders every view below, and passing one is how a
 * host says its URLs changed.
 *
 * @public
 */
export type AssetUrls = (assetId: RecordId) => string | undefined;

/** The host's asset URLs, provided by `<ScreenView>` to the views below it. */
export const AssetsContext: Context<AssetUrls | undefined> = createContext<AssetUrls | undefined>(undefined);

/** An image a view can draw: its URL and, when the asset records it, its natural size. */
export type ImageSource = { readonly href: string; readonly w?: number; readonly h?: number };

/**
 * The drawable image of `assetId` in `store`: the host's URL for it, with the asset's natural size.
 * Reactive: a view re-renders when the asset record changes or appears.
 */
export function useImage(store: Store, assetId: string | undefined): ImageSource | undefined {
  const urls = useContext(AssetsContext);
  const record = useValue(useMemo(() => store.record$((assetId ?? '') as RecordId), [store, assetId]));
  const href = assetId === undefined ? undefined : urls?.(assetId as RecordId);
  if (href === undefined) return undefined;
  const asset = record?.type === 'asset' ? (record as AssetRecord) : undefined;
  return { href, ...(asset?.w === undefined ? {} : { w: asset.w }), ...(asset?.h === undefined ? {} : { h: asset.h }) };
}
