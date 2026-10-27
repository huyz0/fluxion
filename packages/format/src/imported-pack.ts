// Imported definitions as a declarative shape pack (M18.101, ADR-0049/ADR-0182): an index, canonical category
// files and the distribution source the portable writer saves, so a document using an imported shape saves
// with its geometry and credit and reopens offline. Pure: hashing goes through the host's port.
import {
  parseShapeDef,
  parseShapePackCategory,
  parseShapePackIndex,
  type ShapeDef,
  type ShapePackCredit,
  type ShapePackIndex,
  type ShapePackLicensePolicy,
  type ShapePackSource,
} from '@fluxion/core';
import { type Diagnostic, err, ok, type Result } from '@fluxion/schema';
import { canonicalJson } from './canonical-json.js';
import type { ContentHasher } from './flux-write-types.js';
import type { IconifyImportReport } from './iconify-import-types.js';
import { encodeUtf8 } from './utf8.js';

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
  /** Trusted SHA-256 port for the category files. */
  readonly hasher: ContentHasher;
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
const UNCATEGORIZED = 'uncategorized';
const slugOf = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

/**
 * One slug per distinct source category, in first-seen order: names that slug alike (`Charts & Graphs`,
 * `Charts Graphs`) or to nothing (non-Latin names) are numbered, never merged; no category is `uncategorized`.
 */
function slugsOf(entries: readonly ImportedPackEntry[]): Map<string | undefined, string> {
  const slugs = new Map<string | undefined, string>([[undefined, UNCATEGORIZED]]);
  const used = new Set([UNCATEGORIZED]);
  for (const { definition } of entries) {
    const name = definition.category;
    if (slugs.has(name)) continue;
    const base = slugOf(name ?? '') || 'category';
    let slug = base === UNCATEGORIZED ? `${base}-2` : base;
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
    slugs.set(name, slug);
    used.add(slug);
  }
  return slugs;
}

/** Entries with category slugs, grouped by slug in first-seen order. */
function grouped(options: ImportedPackOptions): Result<Map<string, { def: ShapeDef; name: string }[]>, readonly Diagnostic[]> {
  const groups = new Map<string, { def: ShapeDef; name: string }[]>();
  const slugs = slugsOf(options.entries);
  for (const [i, entry] of options.entries.entries()) {
    // pack 1.0 carries no font resources: saving text without its exact face would not render offline (M18.96 owns 1.1)
    if (entry.fonts?.length) return err([problem(`/entries/${i}/fonts`, `${entry.definition.id} needs exact fonts, which a 1.0 pack cannot retain`)]);
    const category = slugs.get(entry.definition.category) as string;
    const def = parseShapeDef({ ...entry.definition, category }, ['entries', i, 'definition']);
    if (!def.ok) return def;
    if (!def.value.id.startsWith(`${options.namespace}:`)) return err([problem(`/entries/${i}/definition/id`, 'definition is outside the pack namespace')]);
    groups.set(category, [...(groups.get(category) ?? []), { def: def.value, name: entry.name }]);
  }
  return groups.size ? ok(groups) : err([problem('/entries', 'a pack needs at least one definition')]);
}

/**
 * Index imported definitions as a declarative pack with one credit covering all of them. Refuses an empty set,
 * IDs outside the namespace, and rights the content policy does not permit; nothing is partial.
 * @public
 */
export async function importedShapePack(options: ImportedPackOptions): Promise<Result<ImportedPack, readonly Diagnostic[]>> {
  const groups = grouped(options);
  if (!groups.ok) return groups;
  const categories = new Map<string, Uint8Array>();
  const envelopes = new Map<string, unknown>();
  const descriptors: Record<string, { path: string; sha256: string }> = {};
  for (const [slug, members] of groups.value) {
    const path = `categories/${slug}.json`;
    const envelope = { formatVersion: '1.0', definitions: members.map((m) => m.def) };
    const bytes = encodeUtf8(canonicalJson(envelope));
    categories.set(path, bytes);
    envelopes.set(slug, envelope);
    descriptors[slug] = { path, sha256: await options.hasher.sha256(bytes.slice()) };
  }
  const members = [...groups.value.values()].flat();
  const credit: ShapePackCredit = { id: 'source', license: options.license, attribution: options.attribution, notice: options.notice, source: options.source };
  const index = parseShapePackIndex(
    {
      format: 'fluxion-shape-pack',
      formatVersion: '1.0',
      id: options.namespace,
      version: options.version,
      name: options.name,
      license: options.license,
      attribution: options.attribution,
      categories: descriptors,
      definitions: members.map(({ def, name }) => ({ id: def.id, name, keywords: def.keywords ?? [], category: def.category as string })),
      credits: [credit],
    },
    options.licensePolicy,
  );
  if (!index.ok) return index;
  for (const [slug, envelope] of envelopes) {
    const category = parseShapePackCategory(envelope, index.value, slug, options.licensePolicy);
    if (!category.ok) return category;
  }
  const definitions = members.map((m) => m.def);
  return ok({ index: index.value, categories, source: { kind: 'distribution', index: index.value, definitions } });
}

/** Version from the source: callers may pin one; otherwise the source hash keeps distinct sources distinct. */
const versionOf = (sha256: string, version: string | undefined): string => version ?? `0.0.0+sha256.${sha256.slice(0, 16)}`;

/**
 * An imported Iconify collection as a pack: every accepted icon (hidden ones too, since documents may use them),
 * credited from the collection's declared name, author and SPDX license and pinned to its source hash. A
 * collection without a declared license cannot be saved portably. Declared rights are not ownership checks.
 * @public
 */
export async function iconifyShapePack(
  report: IconifyImportReport,
  options: Pick<ImportedPackOptions, 'licensePolicy' | 'hasher'> & { readonly version?: string },
): Promise<Result<ImportedPack, readonly Diagnostic[]>> {
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
