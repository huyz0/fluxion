// Imported definitions as a declarative shape pack (M18.101, ADR-0049/ADR-0182): an index, canonical category
// files and the distribution source the portable writer saves, so a document using an imported shape saves
// with its geometry and credit and reopens offline. Encoded by core's shared pack encoder (M18.108, ADR-0196).
import { encodeShapePack, type ShapeDef, type ShapePackCredit, type ShapePackIndex, type ShapePackLicensePolicy, type ShapePackSource } from '@fluxion/core';
import { type Diagnostic, err, ok, type Result } from '@fluxion/schema';
import type { IconifyImportReport } from './iconify-import-types.js';

/** One imported definition with its display name. @public */
export type ImportedPackEntry = {
  /** Converted definition; its category (any text) becomes a category slug. */
  readonly definition: ShapeDef;
  /** Display name for the index and picker. */
  readonly name: string;
  /** Exact faces the converted text needs (`SvgImportResult.fonts`); font-bearing entries are refused here. */
  readonly fonts?: readonly unknown[];
};

/** Pack identity, rights and the definitions to index. @public */
export type ImportedPackOptions = {
  /** Namespace shared by every entry's ID. */
  readonly namespace: string;
  /** Exact semantic version; changes whenever the source does. */
  readonly version: string;
  /** Display name. */
  readonly name: string;
  /** SPDX expression of the source, checked by `licensePolicy`. */
  readonly license: string;
  /** Attribution preserved verbatim. */
  readonly attribution: string;
  /** Notice text supplied by or derived from the source. */
  readonly notice: string;
  /** Where the definitions came from. */
  readonly source: ShapePackSource;
  /** Nonempty definitions in the namespace. */
  readonly entries: readonly ImportedPackEntry[];
  /** Repository content policy; there is no permissive default. */
  readonly licensePolicy: ShapePackLicensePolicy;
};

/** A validated pack: what a distribution publishes and what the portable writer saves. @public */
export type ImportedPack = {
  /** Validated index whose category hashes name `categories` bytes exactly. */
  readonly index: ShapePackIndex;
  /** Canonical category files keyed by their index path. */
  readonly categories: ReadonlyMap<string, Uint8Array>;
  /** Source for `writePortableFlux`'s shape packs. */
  readonly source: {
    /** Distribution metadata plus resolved geometry. */
    readonly kind: 'distribution';
    /** The validated index above. */
    readonly index: ShapePackIndex;
    /** Every indexed definition, with its category slug. */
    readonly definitions: readonly ShapeDef[];
  };
};

const problem = (path: string, message: string): Diagnostic => ({ code: 'FLX_PACK_INVALID', severity: 'error', path, message });
/**
 * An encoder path in the caller's terms: the draft's `/definitions/<i>/def` is `/entries/<i>/definition`, and
 * the index's `/definitions/<i>/name` is `/entries/<i>/name` (the index keeps entry order); its other entry
 * fields (`id`, `keywords`, `category`) come from the definition.
 */
const entryPath = (path: string): string =>
  path
    .replace(/^\/definitions\/(\d+)\/def(?=\/|$)/, '/entries/$1/definition')
    .replace(/^\/definitions\/(\d+)\/name(?=\/|$)/, '/entries/$1/name')
    .replace(/^\/definitions\/(\d+)\/(id|keywords|category)(?=\/|$)/, '/entries/$1/definition/$2')
    .replace(/^\/definitions$/, '/entries');

/**
 * Index imported definitions as a declarative pack with one credit covering all of them, through the shared
 * encoder (`encodeShapePack`, ADR-0196) that first-party packs use. Refuses an empty set, IDs outside the
 * namespace, font-bearing entries and rights the content policy does not permit; nothing is partial.
 *
 * Provenance and licence are the caller's declaration: an SVG or draw.io import states them from what the
 * user declares (their own drawing, or a named upstream with its SPDX licence), and `iconifyShapePack` derives
 * them from the collection's metadata. They are declarations, not ownership checks.
 * @public
 */
export function importedShapePack(options: ImportedPackOptions): Result<ImportedPack, readonly Diagnostic[]> {
  for (const [i, entry] of options.entries.entries()) {
    // pack 1.0 carries no font resources: saving text without its exact face would not render offline (M18.96 owns 1.1)
    if (entry.fonts?.length) return err([problem(`/entries/${i}/fonts`, `${entry.definition.id} needs exact fonts, which a 1.0 pack cannot retain`)]);
  }
  const credit: ShapePackCredit = { id: 'source', license: options.license, attribution: options.attribution, notice: options.notice, source: options.source };
  const encoded = encodeShapePack(
    {
      id: options.namespace,
      version: options.version,
      name: options.name,
      license: options.license,
      attribution: options.attribution,
      credits: [credit],
      definitions: options.entries.map((entry) => ({ name: entry.name, def: entry.definition })),
    },
    options.licensePolicy,
  );
  if (!encoded.ok) return err(encoded.error.map((d) => ({ ...d, path: entryPath(d.path) })));
  const { index, definitions, files } = encoded.value;
  const categories = new Map([...files].filter(([path]) => path !== 'index.json'));
  return ok({ index, categories, source: { kind: 'distribution', index, definitions } });
}

/** Version from the source: callers may pin one; otherwise the source hash keeps distinct sources distinct. */
const versionOf = (sha256: string, version: string | undefined): string => version ?? `0.0.0+sha256.${sha256.slice(0, 16)}`;

/**
 * An imported Iconify collection as a pack: every accepted icon (hidden ones too, since documents may use them),
 * credited from the collection's declared name, author and SPDX license and pinned to its source hash. A
 * collection without a declared license cannot be saved portably. Declared rights are not ownership checks.
 * @public
 */
export function iconifyShapePack(
  report: IconifyImportReport,
  options: Pick<ImportedPackOptions, 'licensePolicy'> & { readonly version?: string },
): Result<ImportedPack, readonly Diagnostic[]> {
  if (report.status !== 'processed') return err([problem('', 'the collection was not imported')]);
  const { prefix, sourceSha256, name, author, license } = report.provenance;
  if (license === undefined) return err([problem('/provenance/license', `collection ${prefix} declares no license; it cannot be saved portably`)]);
  const entries = report.entries.flatMap((e) => (e.status === 'accepted' ? [{ definition: e.value.definition, name: e.name, fonts: e.value.fonts }] : []));
  const namespace = entries[0]?.definition.id.split(':')[0] ?? prefix;
  const title = name ?? prefix;
  const attribution = author ? `${title} by ${author}` : title;
  return importedShapePack({
    ...options,
    namespace,
    version: versionOf(sourceSha256, options.version),
    name: title,
    license,
    attribution,
    notice: `${attribution}, licensed ${license}. Imported from the Iconify collection "${prefix}" (source SHA-256 ${sourceSha256}).`,
    source: { kind: 'upstream', reference: `iconify:${prefix}`, sha256: sourceSha256 },
    entries,
  });
}
