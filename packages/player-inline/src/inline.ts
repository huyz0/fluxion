// The one-file player's entry (ADR-0154): `Fluxion.start(bytes, root)` opens a `.flux`, registers the bundled packs and draws the deck.
// It is the whole of what a `.flux.html` runs: no network, no `eval`, nothing outside the file's own bytes. Bundled by tsdown into
// `dist/player.inline.js` (one classic script that defines the global `Fluxion`).
import { createCore } from '@fluxion/core';
import { type ContentHasher, type LoadedFlux, loadFlux, sanitizeAsset, sha256Hex } from '@fluxion/format';
import { basicPack } from '@fluxion/pack-basic';
import { renderRegistriesFor } from '@fluxion/player';
import { mountPlayer } from '@fluxion/player/mount';
import type { AssetRecord, RecordId } from '@fluxion/schema';
import { loadEmbeddedFonts } from './fonts.js';

/**
 * What `start` came to.
 *
 * @public
 */
export type StartResult =
  | {
      /** The document is on the page. */
      readonly ok: true;
      /** Remove the player and release the images. */
      readonly unmount: () => void;
    }
  | {
      /** Nothing could be shown. */
      readonly ok: false;
      /** Why, as one line (it is also written into the root). */
      readonly message: string;
    };

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

/** Write `message` into `root` as text (never as markup). */
function show(root: HTMLElement, message: string): StartResult {
  root.textContent = message;
  return { ok: false, message };
}

/** Open and draw; any throw is the caller's to turn into a message. */
async function open(bytes: Uint8Array, root: HTMLElement, urls: { release: () => void }[]): Promise<StartResult> {
  const loaded = await loadFlux(bytes, { hasher });
  if (!loaded.ok) return show(root, `This file cannot be opened: ${loaded.error.message}`);
  // a player never writes: its store refuses every transaction (FR-PRS-004)
  const core = createCore(loaded.value.document, { policy: 'read-only' });
  const registered = basicPack.register(core.registries);
  if (!registered.ok) return show(root, `The built-in shapes could not be registered: ${registered.error.map((d) => d.message).join('; ')}`);
  const images = imageUrls(loaded.value);
  urls.push(images);
  // the file's own fonts first: the first paint is in them, measured with their recorded metrics
  const fonts = await loadEmbeddedFonts(loaded.value);
  urls.push(fonts);
  const mounted = mountPlayer(root, core.store, renderRegistriesFor(core.registries), (id: RecordId) => images.urls.get(id));
  return {
    ok: true,
    unmount: () => {
      mounted.unmount();
      images.release();
      fonts.release();
    },
  };
}

/**
 * Open the `.flux` file `bytes` and draw it into `root`: the screens in order, the arrow keys to move. Whatever goes wrong (a file that
 * cannot be opened, a pack that fails to register, a document the engine cannot take, a page that refuses the mount) is a message written
 * into `root`, not an exception, and no image URL is left behind.
 *
 * @public
 */
export async function start(bytes: Uint8Array, root: HTMLElement): Promise<StartResult> {
  const made: { release: () => void }[] = [];
  try {
    const result = await open(bytes, root, made);
    if (!result.ok) for (const m of made) m.release();
    return result;
  } catch (e) {
    for (const m of made) m.release();
    return show(root, `This file cannot be shown: ${e instanceof Error ? e.message : String(e)}`);
  }
}
