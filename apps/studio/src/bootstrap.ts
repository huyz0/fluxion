// Opening a document in the studio (04 §4 "Bootstrapping"): a store for it, the host's first-party
// packs registered into its core registries (ADR-0017: the studio bundles packs/basic), and the
// render registries that draw from them.
import { type Core, createCore } from '@fluxion/core';
import { basicPack } from '@fluxion/pack-basic';
import { themesCorePack } from '@fluxion/pack-themes-core';
import { renderRegistriesFor } from '@fluxion/player';
import { type DocumentFile, err, ok, type Random, type Result } from '@fluxion/schema';

/**
 * An open document: its core (store, registries, commands) and the render registries to draw it.
 *
 * @public
 */
export type OpenDocument = {
  /** The document's core. */
  readonly core: Core;
  /** Element views, shapes and markers, the bundled packs included. */
  readonly registries: ReturnType<typeof renderRegistriesFor>;
  /** The themes the bundled packs offer (the theme switcher's choices). */
  readonly themes: readonly {
    readonly name: string;
    readonly tokens: { readonly [key: string]: unknown };
    readonly defaults?: { readonly [key: string]: unknown };
  }[];
};

/**
 * `file` opened with the bundled packs, or why a pack failed to register (the studio's own fault).
 *
 * @public
 */
export function openDocument(file: DocumentFile): Result<OpenDocument, string> {
  const core = createCore(file);
  const registered = basicPack.register(core.registries);
  if (!registered.ok) return err(`The basic pack failed to register: ${registered.error.map((d) => d.message).join('; ')}`);
  const themed = themesCorePack.register(core.registries);
  if (!themed.ok) return err(`The themes pack failed to register: ${themed.error.map((d) => d.message).join('; ')}`);
  return ok({ core, registries: renderRegistriesFor(core.registries), themes: themesCorePack.themes });
}

/**
 * Randomness for new ids from the platform's cryptographic source.
 *
 * @public
 */
export const cryptoRandom: Random = {
  next: () => (crypto.getRandomValues(new Uint32Array(1))[0] as number) / 2 ** 32,
};
