// Opening a document in the studio (04 §4 "Bootstrapping"): a store for it, the host's first-party
// packs registered into its core registries (ADR-0017: the studio bundles packs/basic), and the
// render registries that draw from them.
import {
  type ArtworkFontBinding,
  allowsShapePackContentLicense,
  type Core,
  createCore,
  createRegistry,
  type Disposable,
  type Logger,
  type Registry,
  registerShapePackSubsets,
  type VersionedShapePackSubset,
} from '@fluxion/core';
import { registerApplyPatchCommand } from '@fluxion/dsl';
import { registerArrangeCommand, registerBuiltInLayouts, registerBuiltInTemplates } from '@fluxion/layout';
import { basicPack } from '@fluxion/pack-basic';
import { themesCorePack } from '@fluxion/pack-themes-core';
import { registerSavedShapePacks, renderRegistriesFor } from '@fluxion/player';
import { type DocumentFile, err, ok, type Result } from '@fluxion/schema';

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
  /** The artwork font bindings of saved 1.1 packs, which the render registries draw with (ADR-0192). */
  readonly artworkFonts: Registry<string, readonly ArtworkFontBinding[]>;
  /** The themes the bundled packs offer (the theme switcher's choices). */
  readonly themes: readonly {
    readonly name: string;
    readonly tokens: { readonly [key: string]: unknown };
    readonly defaults?: { readonly [key: string]: unknown };
  }[];
};

/** The built-in layouts and the `layout.arrange` command (M13.16) in a document's registries, or why one was refused. */
function registerLayouts(registries: Core['registries']): { readonly ok: true } | { readonly ok: false; readonly message: string } {
  const templates = registerBuiltInTemplates(registries.templates);
  if (!templates.ok) return { ok: false, message: `The layout engine failed to register: ${templates.message}` };
  const failed = [registerBuiltInLayouts(registries.layouts), registerArrangeCommand(registries.commands, registries.layouts)].find((r) => !r.ok);
  return failed && !failed.ok ? { ok: false, message: `The layout engine failed to register: ${failed.error.message}` } : { ok: true };
}

/**
 * `file` opened with the bundled packs (read-only when `options.readOnly`; the open is logged at debug level to `options.logger`), or why a pack failed to register (the studio's own fault).
 *
 * `options.shapePacks` contains saved geometry, validated and registered before the host is exposed.
 * Existing namespaces are refused rather than mixing installed and saved versions.
 * @public
 */
export function openDocument(
  file: DocumentFile,
  options: { readonly readOnly?: boolean; readonly logger?: Logger; readonly shapePacks?: readonly VersionedShapePackSubset[] } = {},
): Result<OpenDocument, string> {
  options.logger?.log('debug', 'opening a document', { records: Object.keys(file.records).length, readOnly: options.readOnly === true });
  const core = createCore(file, options.readOnly === true ? { policy: 'read-only' } : {});
  const registered = basicPack.register(core.registries);
  if (!registered.ok) return err(`The basic pack failed to register: ${registered.error.map((d) => d.message).join('; ')}`);
  const themed = themesCorePack.register(core.registries);
  if (!themed.ok) return err(`The themes pack failed to register: ${themed.error.map((d) => d.message).join('; ')}`);
  const embedded = registerShapePackSubsets(core.registries.shapeDefs, options.shapePacks ?? [], allowsShapePackContentLicense);
  if (!embedded.ok) return err(`The saved shapes could not be registered: ${embedded.error.map((d) => d.message).join('; ')}`);
  const laidOut = registerLayouts(core.registries);
  if (!laidOut.ok) return err(laidOut.message);
  // `ai.applyPatch` (FR-AI-003): the AI panel's Apply
  const patching = registerApplyPatchCommand(core.registries.commands, core.registries);
  if (!patching.ok) return err(`The AI patch command failed to register: ${patching.error.message}`);
  const artworkFonts = createRegistry<string, readonly ArtworkFontBinding[]>('artworkFonts');
  return ok({ core, registries: renderRegistriesFor(core.registries, artworkFonts), artworkFonts, themes: themesCorePack.themes });
}

/**
 * Register a file's saved 1.0 and 1.1 packs into `opened` (made by {@link openDocument} without them) through
 * `registerSavedShapePacks`: each exact artwork font `fonts` holds is verified and loaded under its private alias first, then geometry and
 * bindings. The document must not be shown before this resolves. A refusal (missing or changed bytes, a face that does not load, a
 * cancelled `signal`) is one line and leaves no face, definition or binding behind, so no artwork text falls back to another face. The
 * disposer releases them with the file; edits and their undo or redo never touch them.
 *
 * @public
 */
export async function registerOpenedShapePacks(
  opened: OpenDocument,
  packs: readonly VersionedShapePackSubset[],
  fonts: ReadonlyMap<string, Uint8Array>,
  ports: { readonly sha256: (bytes: Uint8Array) => Promise<string>; readonly signal?: AbortSignal; readonly fonts?: FontFaceSet },
): Promise<Result<Disposable, string>> {
  const registered = await registerSavedShapePacks({ shapeDefs: opened.core.registries.shapeDefs, artworkFonts: opened.artworkFonts }, packs, {
    ...ports,
    bytesOf: (sha) => fonts.get(sha),
    policy: allowsShapePackContentLicense,
  });
  return registered.ok ? registered : err(`The saved shapes could not be registered: ${registered.error.map((d) => d.message).join('; ')}`);
}

export { cryptoRandom } from './random.js';
