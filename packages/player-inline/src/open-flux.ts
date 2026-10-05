// What opening a `.flux` for presenting comes to, for the one-file player (`start`) and the element (`defineFluxionPlayer`): the lean reader, a read-only store,
// the bundled pack, the images of the file as blob URLs and its fonts. One path, so the two present the same file the same way.
import { type CoreRegistries, createCore, type Registry } from '@fluxion/core';
import { type ContentHasher, type LoadedFlux, loadFluxLean, sanitizeAsset, sha256Hex } from '@fluxion/format/player';
import { basicPack } from '@fluxion/pack-basic';
import { renderRegistriesFor } from '@fluxion/player';
import type { OpenedFlux } from '@fluxion/player/element';
import type { AssetRecord, RecordId } from '@fluxion/schema';
import { loadEmbeddedFonts } from './fonts.js';

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
 * as they are (`basicPack.register` would validate each with Zod, which the script does not carry). Returns why one was refused, or nothing.
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
 * images and fonts. Whatever goes wrong is a message, and nothing is left behind (no image URL, no font face).
 *
 * @public
 */
export async function openFlux(
  bytes: Uint8Array,
): Promise<{ readonly ok: true; readonly value: OpenedFlux } | { readonly ok: false; readonly message: string }> {
  const made: { release: () => void }[] = [];
  const release = () => {
    for (const m of made) m.release();
  };
  try {
    const loaded = await loadFluxLean(bytes, { hasher });
    if (!loaded.ok) return { ok: false, message: `This file cannot be opened: ${loaded.error.message}` };
    // a player never writes: its store refuses every transaction (FR-PRS-004)
    const core = createCore(loaded.value.document, { policy: 'read-only' });
    const refused = registerBundled(core.registries);
    if (refused !== undefined) return { ok: false, message: `The built-in shapes could not be registered: ${refused}` };
    const images = imageUrls(loaded.value);
    made.push(images);
    // the file's own fonts first: the first paint is in them, measured with their recorded metrics
    made.push(await loadEmbeddedFonts(loaded.value));
    return { ok: true, value: { store: core.store, registries: renderRegistriesFor(core.registries), assets: (id: RecordId) => images.urls.get(id), release } };
  } catch (e) {
    release();
    return { ok: false, message: `This file cannot be shown: ${e instanceof Error ? e.message : String(e)}` };
  }
}
