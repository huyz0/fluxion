// Registration of a converted SVG library (FR-LIB-004, M18.175): the final pack only, all or nothing, under a namespace nothing
// else holds. Its exact fonts are verified and loaded under their private aliases before any definition is registered, so text
// never draws in another face; the pack's source is what a save retains (FR-LIB-009, ADR-0192).
import type { Disposable, ShapeDef } from '@fluxion/core';
import { type ArtworkShapeRegistries, allowsShapePackContentLicense } from '@fluxion/core';
import { type ImportedPack, shapePackSubsetOf } from '@fluxion/format';
import { type ArtworkFontPorts, registerSavedShapePacks } from '@fluxion/render';
import { type Diagnostic, err, ok, type Result } from '@fluxion/schema';
import { entryOf, type LibraryEntry } from './library-search.js';

/** A registered SVG library. @public */
export type SvgLibrary = Disposable & {
  /** Library entries of every registered definition. */
  readonly entries: readonly LibraryEntry[];
};

/**
 * Register every definition of `pack` (and its exact fonts) into `registries`; refuses a held namespace and leaves nothing behind
 * on any refusal.
 * @public
 */
export async function registerSvgLibrary(
  registries: ArtworkShapeRegistries,
  pack: ImportedPack,
  ports: ArtworkFontPorts,
): Promise<Result<SvgLibrary, readonly Diagnostic[]>> {
  const subset = shapePackSubsetOf(pack.source, allowsShapePackContentLicense);
  if (!subset.ok) return subset;
  const registered = await registerSavedShapePacks(registries, [subset.value], {
    ...ports,
    bytesOf: (sha256) => pack.source.fonts.get(sha256),
    policy: allowsShapePackContentLicense,
  });
  if (!registered.ok) return err(registered.error);
  const definitions: readonly ShapeDef[] = subset.value.definitions;
  return ok({ entries: definitions.map(entryOf), dispose: registered.value.dispose });
}
