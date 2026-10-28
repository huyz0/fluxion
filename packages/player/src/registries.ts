// The render registries of a host's core registries (ADR-0017): the built-in views, routers and
// markers, with shapes and markers read from the core registries the host's packs registered into.
import type { ArtworkFontBinding, CoreRegistries, Registry } from '@fluxion/core';
import { builtinRegistries, type RenderRegistries } from '@fluxion/render';

/**
 * Render registries drawing from `host` (a document's core registries, packs registered), with the
 * artwork font bindings of saved 1.1 packs from `artworkFonts` (M18.97).
 *
 * @public
 */
export function renderRegistriesFor(host: CoreRegistries, artworkFonts?: Registry<string, readonly ArtworkFontBinding[]>): RenderRegistries {
  return builtinRegistries(host.shapeDefs, undefined, host.markers, artworkFonts);
}
