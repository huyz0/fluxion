// The studio's SVG library importer (FR-LIB-004, M18.17): the editor's Import SVG… converts through the shipped renderer's paint
// witness over this page, with fonts-core's Inter 400 (its bytes as the studio serves them, its OFL-1.1 notice) as the one face text
// may draw in, and registers the final pack, with its exact face, into the open document's registries. Every registered pack's
// source is kept for the save (FR-LIB-009, ADR-0192); disposing releases the packs and forgets their sources.
import {
  convertSvgLibrary,
  type LibraryImporter,
  type LibraryImportRequest,
  registerSvgLibrary,
  type SvgLibrary,
  type SvgLibraryFont,
  svgWitnessStarter,
} from '@fluxion/editor';
import type { ShapePackSourceData } from '@fluxion/format';
import { FONTS_CORE } from '@fluxion/pack-fonts-core';
import { type Diagnostic, err, ok, type Result, type TokenRef } from '@fluxion/schema';
import type { OpenDocument } from './bootstrap.js';
import { webHasher } from './file-session.js';
import { bundledFontUrl } from './fonts.js';

type WitnessTheme = Parameters<typeof svgWitnessStarter>[0]['theme'];

// the licence text fonts-core ships beside its faces, carried verbatim into a 1.1 pack's font rights
const OFL = Object.values(import.meta.glob('../../../packs/fonts-core/OFL.txt', { query: '?raw', import: 'default', eager: true }))[0] ?? '';

const refused = (message: string): readonly Diagnostic[] => [{ code: 'FLX_SVG_IMPORT_INVALID', severity: 'error', path: '/input', message }];

/** The reference of every color token under `tree` (`{color.accent}`), in token order. */
function colorRefs(tree: unknown, path: string): TokenRef[] {
  if (typeof tree !== 'object' || tree === null) return [];
  if ('$value' in tree) return [`{${path}}` as TokenRef];
  return Object.entries(tree).flatMap(([key, value]) => (key.startsWith('$') ? [] : colorRefs(value, `${path}.${key}`)));
}

/** fonts-core's Inter 400 normal as the batch's face: the bytes the studio serves, hashed, with the face's own rights. */
async function interFont(fetchBytes: typeof fetch): Promise<Result<SvgLibraryFont, readonly Diagnostic[]>> {
  const def = FONTS_CORE.find((f) => f.family === 'Inter' && f.weight === 400 && f.style === 'normal');
  const url = bundledFontUrl(def?.file ?? '');
  if (def === undefined || url === undefined || OFL === '') return err(refused('The bundled Inter face is not available.'));
  const response = await fetchBytes(url);
  if (!response.ok) return err(refused(`The bundled Inter face could not be read (${response.status}).`));
  const bytes = new Uint8Array(await response.arrayBuffer());
  const sha256 = await webHasher.sha256(bytes);
  const source = { kind: 'upstream' as const, reference: `@fluxion/pack-fonts-core:${def.file}`, sha256 };
  return ok({
    face: { family: 'Inter', weight: 400, style: 'normal', sha256 },
    rights: { bytes, license: def.license ?? 'OFL-1.1', attribution: def.copyright ?? 'The Inter Project Authors', notice: OFL, source },
  });
}

/**
 * The studio's importer over `opened`, and the sources of the packs it registered.
 *
 * @public
 */
export type StudioLibraryImports = {
  /** The editor's port (`EditorRoot.libraryImporter`). */
  readonly importer: LibraryImporter;
  /** The sources of the packs registered so far, for the save (`FileBar.shapePackSources`); a new array after each change. */
  readonly sources: () => readonly ShapePackSourceData[];
  /** Calls `listener` after each change to {@link StudioLibraryImports.sources}; returns its removal. */
  readonly subscribe: (listener: () => void) => () => void;
  /** Releases every registered pack (definitions, bindings, faces) and forgets its source; a registration still pending is released as it ends; later imports work as before. */
  readonly dispose: () => void;
};

/**
 * An importer that witnesses in `ports.document` under the bundled light theme and registers into `opened`.
 *
 * @public
 */
export function studioLibraryImports(
  opened: Pick<OpenDocument, 'core' | 'artworkFonts' | 'themes'>,
  ports: { readonly document: Document; readonly fetch: typeof fetch; readonly now: () => number },
): StudioLibraryImports {
  const theme = opened.themes.find((th) => th.name === 'light') as WitnessTheme | undefined;
  const colorTokens = colorRefs(theme?.tokens['color'], 'color');
  let font: Promise<Result<SvgLibraryFont, readonly Diagnostic[]>> | undefined;
  let registered: { readonly library: SvgLibrary; readonly source: ShapePackSourceData }[] = [];
  let sources: readonly ShapePackSourceData[] = [];
  // bumped by each dispose: a registration that began before it is released as it ends
  let epoch = 0;
  const listeners = new Set<() => void>();
  const changed = () => {
    sources = registered.map((r) => r.source);
    for (const listener of listeners) listener();
  };
  const convert = async (input: Parameters<LibraryImporter['convert']>[0], request: LibraryImportRequest) => {
    if (theme === undefined) return err([{ path: '', message: 'The studio has no light theme to witness under.' }]);
    // a failed read is not kept, so a later convert tries again
    font ??= interFont(ports.fetch).then((r) => {
      if (!r.ok) font = undefined;
      return r;
    });
    const inter = await font;
    if (!inter.ok) return err(inter.error.map((d) => ({ path: '', message: d.message })));
    const witnessFont = { ...inter.value.face, bytes: inter.value.rights.bytes, profile: 'inter-latin-400-ascii' as const };
    return convertSvgLibrary(input, {
      ...request,
      tokenRefs: new Set(colorTokens),
      fonts: [inter.value],
      now: ports.now,
      startWitness: svgWitnessStarter({ document: ports.document, theme, fonts: [witnessFont] }),
    });
  };
  const importer: LibraryImporter = {
    convert,
    colorTokens,
    async register(pack) {
      const began = epoch;
      const library = await registerSvgLibrary({ shapeDefs: opened.core.registries.shapeDefs, artworkFonts: opened.artworkFonts }, pack, {
        sha256: webHasher.sha256,
      });
      if (!library.ok) return library;
      // the document closed while the pack registered: it is released at once rather than left behind in a disposed importer
      if (began !== epoch) {
        library.value.dispose();
        return err([{ code: 'FLX_SVG_IMPORT_INVALID', severity: 'error', path: '', message: 'The document closed before the import finished.' }]);
      }
      registered = [...registered, { library: library.value, source: pack.source }];
      changed();
      return ok(undefined);
    },
  };
  return {
    importer,
    sources: () => sources,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      epoch++;
      const held = registered;
      registered = [];
      for (const r of held) r.library.dispose();
      if (held.length > 0) changed();
    },
  };
}
