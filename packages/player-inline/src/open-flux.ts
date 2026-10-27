// What opening a `.flux` for presenting comes to, for the one-file player (`start`) and the element (`defineFluxionPlayer`): the lean reader, a read-only store,
// the bundled pack, the images of the file as blob URLs and its fonts. One path, so the two present the same file the same way.

import {
  type ArtworkFontBinding,
  allowsShapePackContentLicense,
  type CoreRegistries,
  createCoreRegistries,
  createRegistry,
  createStore,
  type Registry,
} from '@fluxion/core';
import { type ContentHasher, type LoadedFlux, loadFluxLean, sanitizeAsset, sha256Hex } from '@fluxion/format/player';
import { basicPack } from '@fluxion/pack-basic';
import { renderRegistriesFor } from '@fluxion/player';
import type { OpenedFlux } from '@fluxion/player/element';
import { registerSavedShapePacks } from '@fluxion/render';
import type { AssetRecord, RecordId } from '@fluxion/schema';
import { loadEmbeddedFonts } from './fonts.js';
import type { RoutingWorker } from './routing-chunk-loader.js';
import { workerRoutes } from './worker-routes.js';

/** SubtleCrypto where the page has it (it needs a secure context), else the pure SHA-256 of `format`. */
const hasher: ContentHasher = {
  async sha256(bytes) {
    const subtle = globalThis.crypto?.subtle;
    if (subtle === undefined) return sha256Hex(bytes);
    const digest = new Uint8Array(await subtle.digest('SHA-256', bytes.slice().buffer));
    return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
  },
};

/** Blob URLs of the image assets the document refers to, from the verified, sanitized bytes (an SVG is rebuilt from the allowlist first). */
function imageUrls(loaded: LoadedFlux): { readonly urls: Map<string, string>; readonly release: () => void } {
  const urls = new Map<string, string>();
  for (const record of Object.values(loaded.document.records)) {
    if (record.type !== 'asset') continue;
    const asset = record as AssetRecord & { readonly font?: unknown };
    const bytes = loaded.assets.get(asset.hash);
    const safe = bytes === undefined || asset.font !== undefined ? undefined : sanitizeAsset(bytes);
    if (safe !== undefined) urls.set(asset.id, URL.createObjectURL(new Blob([safe.bytes.slice().buffer], { type: safe.mime })));
  }
  return {
    urls,
    release: () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
    },
  };
}

/**
 * Register the bundled pack's shapes and markers. The pack is this script's own code, checked when it is built, so its definitions go into the registries
 * as they are; saved external data uses the separate validated registration path. Returns why one was refused, or nothing.
 */
function registerBundled(registries: Pick<CoreRegistries, 'shapeDefs' | 'markers'>): string | undefined {
  for (const [registry, items] of [
    [registries.shapeDefs, basicPack.shapes],
    [registries.markers, basicPack.markers],
  ] as const) {
    for (const item of items as readonly { readonly id: string }[]) {
      const done = (registry as Registry<string, { readonly id: string }>).register(item.id, item, basicPack.id);
      if (!done.ok) return done.error.message;
    }
  }
  return undefined;
}

/**
 * Open the `.flux` file `bytes` for presenting: the document in a store that refuses every write (FR-PRS-004), the registries with the bundled shapes, the file's
 * images and fonts. The connectors draw the cheap routes, then the global routing pass's routes as `routing` (the lazily loaded routing
 * chunk's worker, M16.28) routes each screen; `settled` hears whether every screen was routed, and false at once without a worker. Whatever goes wrong is a message, and nothing is left behind (no image URL, no font face).
 *
 * @public
 */
export async function openFlux(
  bytes: Uint8Array,
  routing?: RoutingWorker,
  settled: (ok: boolean) => void = () => undefined,
): Promise<{ readonly ok: true; readonly value: OpenedFlux } | { readonly ok: false; readonly message: string }> {
  const made: { release: () => void }[] = [];
  const release = () => {
    for (const m of made) m.release();
    routing?.dispose();
  };
  // a file that cannot be shown leaves nothing behind, its routing worker included, and its routes are the cheap ones
  const fail = (message: string) => {
    release();
    settled(false);
    return { ok: false, message } as const;
  };
  try {
    const loaded = await loadFluxLean(bytes, { hasher, shapePackLicensePolicy: allowsShapePackContentLicense });
    if (!loaded.ok) return fail(`This file cannot be opened: ${loaded.error.message}`);
    // a player never writes: its store refuses every transaction (FR-PRS-004), so it is made without the editing commands and integrity
    // hooks createCore would register (they only act on writes), which keeps them out of the script
    const store = createStore(loaded.value.document, { policy: 'read-only' });
    const registries = createCoreRegistries();
    const refused = registerBundled(registries);
    if (refused !== undefined) return fail(`The built-in shapes could not be registered: ${refused}`);
    // saved packs' artwork text draws only in its exact retained fonts, under private aliases: missing bytes refuse the file (M18.97)
    const artworkFonts = createRegistry<string, readonly ArtworkFontBinding[]>('artworkFonts');
    const assets = loaded.value.assets;
    const embedded = await registerSavedShapePacks({ shapeDefs: registries.shapeDefs, artworkFonts }, loaded.value.shapePacks, {
      bytesOf: (sha) => assets.get(sha)?.bytes,
      policy: allowsShapePackContentLicense,
      sha256: (b) => hasher.sha256(b),
    });
    if (!embedded.ok) return fail(`The saved shapes could not be registered: ${embedded.error.map((d) => d.message).join('; ')}`);
    made.push({ release: () => embedded.value.dispose() });
    const images = imageUrls(loaded.value);
    made.push(images);
    // the file's own fonts first: the first paint is in them, measured with their recorded metrics
    made.push(await loadEmbeddedFonts(loaded.value));
    const render = renderRegistriesFor(registries, artworkFonts);
    if (routing === undefined) settled(false);
    const routes = routing === undefined ? undefined : workerRoutes(store, render, routing);
    void routes?.done.then(settled);
    return {
      ok: true,
      value: {
        store,
        registries: routes === undefined ? render : { ...render, refined: routes.refined },
        assets: (id: RecordId) => images.urls.get(id),
        release,
      },
    };
  } catch (e) {
    return fail(`This file cannot be shown: ${e instanceof Error ? e.message : String(e)}`);
  }
}
