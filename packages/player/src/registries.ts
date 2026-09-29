// The render registries of a host's core registries (ADR-0017): the built-in views, routers and
// markers, with shapes and markers read from the core registries the host's packs registered into.
import type { CoreRegistries } from '@fluxion/core';
import { builtinRegistries, type RenderRegistries } from '@fluxion/render';

/**
 * Render registries drawing from `host` (a document's core registries, packs registered).
 *
 * @public
 */
export function renderRegistriesFor(host: CoreRegistries): RenderRegistries {
  return builtinRegistries(host.shapeDefs, undefined, host.markers);
}
