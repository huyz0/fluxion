// Studio Iconify and draw.io library import (FR-LIB-005, FR-LIB-006, FR-LIB-009, M18.210): one picked collection or library file
// becomes one checked shape pack, so a document that uses its shapes saves them portably. `convertCollectionLibrary` registers
// nothing (`registerSvgLibrary` registers the pack, whatever its source). The file is bounded before it is read, every entry is
// witnessed through rotating sessions, and the accepted ones make the pack; the refused ones are listed, as the library importers
// before it listed them (best effort, FR-LIB-006). Rights are declared, never inferred: an Iconify collection's own SPDX licence,
// or the one credit the person declares for a draw.io library (ADR-0050).
import { allowsShapePackContentLicense } from '@fluxion/core';
import {
  type DrawioImportReport,
  type IconifyImportReport,
  type ImportedPack,
  type ImportedPackEntry,
  INPUT_LIMITS,
  iconifyShapePack,
  importDrawioLibrary,
  importedShapePack,
  importIconifyCollection,
  type SvgImportFont,
  type SvgMemberProblem,
  type SvgPaintWitness,
  witnessSessions,
} from '@fluxion/format';
import { type Diagnostic, err, ok, type Result } from '@fluxion/schema';
import { rightsOf, type SvgLibraryOptions, type SvgLibraryRights } from './import-svg.js';
import type { SvgLibraryItem } from './import-svg-input.js';

/** One picked Iconify collection (`.json`) or draw.io library (`.xml`). @public */
export type CollectionLibraryInput = {
  /** Which converter reads it. */
  readonly kind: 'iconify' | 'drawio';
  /** The picked file. */
  readonly item: SvgLibraryItem;
};

/** What converting a collection needs: the host's witness, clock and faces, and for draw.io the pack identity and declared rights. @public */
export type CollectionLibraryOptions = Pick<SvgLibraryOptions, 'fonts' | 'startWitness' | 'now'> & {
  /** draw.io only: the pack identity and its one declared credit (a credits file names member paths, which a library has none of). */
  readonly declared?: Pick<SvgLibraryOptions, 'namespace' | 'version' | 'name'> & {
    /** The one credit: the person's own work or an upstream source. */
    readonly rights: Exclude<
      SvgLibraryRights,
      {
        /** The credits-file form, which a library cannot take. */
        readonly kind: 'credits';
      }
    >;
  };
};

/** A converted collection, registered nowhere yet. @public */
export type CollectionLibraryConversion = {
  /** The checked pack: its files, and the source a save retains. */
  readonly pack: ImportedPack;
  /** The entries left out of the pack, each by its name in the source. */
  readonly omitted: readonly SvgMemberProblem[];
};

const whole = (message: string): SvgMemberProblem => ({ path: '', message });
const refusedWith = (diagnostics: readonly Diagnostic[]) => err(diagnostics.map((d) => whole(d.message)));

/** The file's text, or why it is not read: over the entry bound (from its listed size, before any byte is read) or not UTF-8. */
async function textOf(item: SvgLibraryItem): Promise<Result<string, readonly SvgMemberProblem[]>> {
  if (!(item.size <= INPUT_LIMITS.maxEntryBytes)) return err([{ path: item.name, message: 'entry exceeds 128 MiB' }]);
  try {
    return ok(new TextDecoder('utf-8', { fatal: true }).decode(await item.bytes()));
  } catch {
    return err([{ path: item.name, message: 'not UTF-8 text' }]);
  }
}

/** `convert` run with a witness that rotates sessions, the last disposed whatever happens; a session failure is the refusal. */
async function witnessed<R>(
  options: CollectionLibraryOptions,
  convert: (witness: SvgPaintWitness) => Promise<R>,
): Promise<Result<R, readonly SvgMemberProblem[]>> {
  const sessions = await witnessSessions(options.startWitness, options.now);
  if (!sessions.ok) return refusedWith(sessions.error);
  let report: R;
  try {
    report = await convert(sessions.value.witness);
  } finally {
    await sessions.value.dispose();
  }
  const failure = sessions.value.failure();
  return failure === undefined ? ok(report) : refusedWith(failure);
}

/** The faces text may draw in, as the converters take them. */
const facesOf = (options: CollectionLibraryOptions): { fonts?: SvgImportFont[]; defaultFont?: string } => {
  const faces = (options.fonts ?? []).map((f) => f.face);
  return faces.length ? { fonts: faces, defaultFont: (faces[0] as SvgImportFont).sha256 } : {};
};

/** The refused entries of a processed report, by name; the whole report's diagnostics when it failed. */
function omittedOf(report: IconifyImportReport | DrawioImportReport): SvgMemberProblem[] {
  if (report.status === 'failed') return report.diagnostics.map((d) => whole(d.message));
  return report.entries.flatMap((e) =>
    e.status === 'refused' ? e.diagnostics.map((d) => ({ path: 'name' in e ? e.name : (e.title ?? e.id), message: d.message })) : [],
  );
}

/** An Iconify collection as a pack, credited from its own declared name, author and SPDX licence (`iconifyShapePack`). */
async function iconify(text: string, options: CollectionLibraryOptions): Promise<Result<CollectionLibraryConversion, readonly SvgMemberProblem[]>> {
  const report = await witnessed(options, (witness) => importIconifyCollection(text, { witness, ...facesOf(options) }));
  if (!report.ok) return report;
  if (report.value.status === 'failed') return err(omittedOf(report.value));
  if (report.value.acceptedCount === 0) return err([whole('no icon of the collection was converted'), ...omittedOf(report.value)]);
  const pack = iconifyShapePack(report.value, { licensePolicy: allowsShapePackContentLicense, fonts: (options.fonts ?? []).map((f) => f.rights) });
  return pack.ok ? ok({ pack: pack.value, omitted: omittedOf(report.value) }) : refusedWith(pack.error);
}

/** A draw.io library as a pack under the declared identity and its one declared credit. */
async function drawio(text: string, options: CollectionLibraryOptions): Promise<Result<CollectionLibraryConversion, readonly SvgMemberProblem[]>> {
  const declared = options.declared;
  if (declared === undefined) return err([whole('declare the namespace, version, name and rights of the library')]);
  const rights = rightsOf(declared.rights);
  if (typeof rights === 'string') return err([whole(rights)]);
  // the content policy is checked before any witness starts, so a refused licence costs no conversion
  if (!allowsShapePackContentLicense(rights.license)) return err([whole(`the content license policy does not permit ${rights.license}`)]);
  const report = await witnessed(options, (witness) => importDrawioLibrary(text, { namespace: declared.namespace, witness, ...facesOf(options) }));
  if (!report.ok) return report;
  if (report.value.status === 'failed') return err(omittedOf(report.value));
  const entries: ImportedPackEntry[] = report.value.entries.flatMap((e) =>
    e.status === 'accepted' ? [{ definition: e.value.definition, name: e.title ?? e.id, fonts: e.value.fonts }] : [],
  );
  if (entries.length === 0) return err([whole('no shape of the library was converted'), ...omittedOf(report.value)]);
  const [credit] = rights.credits;
  const pack = importedShapePack({
    namespace: declared.namespace,
    version: declared.version,
    name: declared.name,
    license: rights.license,
    attribution: rights.attribution,
    notice: credit?.notice ?? '',
    source: credit?.source ?? { kind: 'original', author: rights.attribution, statement: '' },
    entries,
    fonts: (options.fonts ?? []).map((f) => f.rights),
    licensePolicy: allowsShapePackContentLicense,
  });
  return pack.ok ? ok({ pack: pack.value, omitted: omittedOf(report.value) }) : refusedWith(pack.error);
}

/**
 * Convert one picked Iconify collection or draw.io library into a checked pack, registering nothing; or every refusal, each by its
 * path ('' for the whole file). The file's size is checked before it is read; for draw.io, the rights and the licence policy before
 * any witness starts. Entries a converter refuses are left out and listed in `omitted`.
 * @public
 */
export async function convertCollectionLibrary(
  input: CollectionLibraryInput,
  options: CollectionLibraryOptions,
): Promise<Result<CollectionLibraryConversion, readonly SvgMemberProblem[]>> {
  const text = await textOf(input.item);
  if (!text.ok) return text;
  return input.kind === 'iconify' ? iconify(text.value, options) : drawio(text.value, options);
}
