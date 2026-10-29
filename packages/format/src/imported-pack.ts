// Imported definitions as a declarative shape pack (M18.101, ADR-0049/ADR-0182): an index, canonical category
// files and the distribution source the portable writer saves, so a document using an imported shape saves
// with its geometry and credit and reopens offline. Encoded by core's shared pack encoder (M18.108, ADR-0196).
import {
  artworkFontProfiles,
  encodeShapePack,
  type ShapeDef,
  type ShapePackCredit,
  type ShapePackDraftFonts,
  type ShapePackFontFace,
  type ShapePackLicensePolicy,
  type ShapePackSource,
  type VersionedShapePackIndex,
} from '@fluxion/core';
import { type Diagnostic, err, ok, type Result } from '@fluxion/schema';
import type { IconifyImportReport } from './iconify-import-types.js';
import { sha256Hex } from './sha256.js';
import type { SvgImportFont } from './svg-import-types.js';

/** One imported definition with its display name. @public */
export type ImportedPackEntry = {
  /** Converted definition; its category (any text) becomes a category slug. */
  readonly definition: ShapeDef;
  /** Display name for the index and picker. */
  readonly name: string;
  /** Exact faces the converted text needs (`SvgImportResult.fonts`); their bytes and rights come from the options' `fonts`. */
  readonly fonts?: readonly SvgImportFont[];
};

/**
 * The exact bytes of a font imported text uses, with the rights the user or host declares for it (ADR-0192). Only supported
 * artwork profiles (`artworkFontProfiles`) and font licenses (`artworkFontLicenses`) are accepted; rights are never inferred.
 *
 * @public
 */
export type ImportedPackFont = {
  /** The exact WOFF2 bytes; their SHA-256 is the face identity entries name. */
  readonly bytes: Uint8Array;
  /** SPDX identifier of the font's own license. */
  readonly license: string;
  /** Attribution preserved verbatim. */
  readonly attribution: string;
  /** Complete notice text. */
  readonly notice: string;
  /** Where the font came from; inert, never fetched. */
  readonly source: ShapePackSource;
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
  /** The fonts entries' text uses (ADR-0192): with any font-bearing entry the pack is a 1.1 that retains them. */
  readonly fonts?: readonly ImportedPackFont[];
  /**
   * Credits scoped to the entries they cover, for sources of mixed rights (ADR-0206): when present they are the
   * pack's credits instead of the one built from `notice` and `source`; each names `definitionIds`, and together
   * they cover every entry exactly once.
   */
  readonly credits?: readonly ShapePackCredit[];
};

/** A validated pack: what a distribution publishes and what the portable writer saves. @public */
export type ImportedPack = {
  /** Validated index whose category hashes name `categories` bytes exactly; 1.1 when entries need fonts. */
  readonly index: VersionedShapePackIndex;
  /** Canonical category files keyed by their index path. */
  readonly categories: ReadonlyMap<string, Uint8Array>;
  /** Exact font files keyed by their index path (`fonts/<sha256>.woff2`); empty for a 1.0 pack. */
  readonly fontFiles: ReadonlyMap<string, Uint8Array>;
  /** Every canonical file of the pack directory by pack-relative path: `index.json`, then the categories, then the fonts. */
  readonly files: ReadonlyMap<string, Uint8Array>;
  /** Source for `writePortableFlux`'s shape packs. */
  readonly source: {
    /** Distribution metadata plus resolved geometry. */
    readonly kind: 'distribution';
    /** The validated index above. */
    readonly index: VersionedShapePackIndex;
    /** Every indexed definition, with its category slug. */
    readonly definitions: readonly ShapeDef[];
    /** The exact font bytes by SHA-256, retained by a portable save. */
    readonly fonts: ReadonlyMap<string, Uint8Array>;
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

const resourceId = (sha: string): string => `font-${sha.slice(0, 16)}`;

/** Why `face` cannot be retained from `declared`, or undefined when it can. */
function faceRefusal(face: SvgImportFont, declared: ReadonlyMap<string, ImportedPackFont>, id: string): string | undefined {
  if (!declared.has(face.sha256)) return `${id} needs font ${face.sha256}, whose bytes and rights were not supplied`;
  const profile = Object.values(artworkFontProfiles).find((p) => p.sha256 === face.sha256);
  if (profile === undefined || profile.weight !== face.weight || profile.style !== face.style)
    return `font ${face.sha256} is not a supported artwork profile at weight ${face.weight} ${face.style}`;
  return undefined;
}

/** The id of `face` in `faces`, one per byte identity and source family, added when new. */
function faceId(faces: Map<string, ShapePackFontFace>, face: SvgImportFont): string {
  // one face per font and family as the 1.1 parser compares families: case-insensitively (M18.81 r2 F1)
  const key = `${face.sha256}\n${face.family.toLowerCase()}`;
  const id = faces.get(key)?.id ?? `face-${faces.size + 1}`;
  faces.set(key, { id, family: face.family, weight: 400, style: 'normal', resource: resourceId(face.sha256) });
  return id;
}

/** The faces, bindings and per-font users of `entries`; a face that cannot be retained refuses them all. */
function bindings(entries: readonly ImportedPackEntry[], declared: ReadonlyMap<string, ImportedPackFont>) {
  const faces = new Map<string, ShapePackFontFace>();
  const used = new Map<string, ShapeDef['id'][]>();
  const definitionFonts: { definitionId: ShapeDef['id']; faceIds: string[] }[] = [];
  for (const [i, entry] of entries.entries()) {
    const faceIds: string[] = [];
    for (const [j, face] of (entry.fonts ?? []).entries()) {
      const refused = faceRefusal(face, declared, entry.definition.id);
      if (refused !== undefined) return err([problem(`/entries/${i}/fonts/${j}`, refused)]);
      faceIds.push(faceId(faces, face));
      used.set(face.sha256, [...new Set([...(used.get(face.sha256) ?? []), entry.definition.id])]);
    }
    if (faceIds.length) definitionFonts.push({ definitionId: entry.definition.id, faceIds: [...new Set(faceIds)] });
  }
  return ok({ faces: [...faces.values()], used, definitionFonts });
}

/** The supplied fonts by SHA-256; the same bytes declared twice with different rights are refused, never one silently kept. */
function declaredFonts(fonts: readonly ImportedPackFont[]): Result<ReadonlyMap<string, ImportedPackFont>, readonly Diagnostic[]> {
  const declared = new Map<string, ImportedPackFont>();
  const rights = ({ license, attribution, notice, source }: ImportedPackFont) => JSON.stringify([license, attribution, notice, source]);
  for (const [i, font] of fonts.entries()) {
    const sha = sha256Hex(font.bytes);
    const earlier = declared.get(sha);
    if (earlier !== undefined && rights(earlier) !== rights(font)) return err([problem(`/fonts/${i}`, `font ${sha} is declared twice with different rights`)]);
    declared.set(sha, font);
  }
  return ok(declared);
}

/** The pack 1.1 font metadata for `entries`, from the declared `fonts`; undefined when no entry needs a font. */
function draftFonts(entries: readonly ImportedPackEntry[], fonts: readonly ImportedPackFont[]): Result<ShapePackDraftFonts | undefined, readonly Diagnostic[]> {
  if (!entries.some((e) => e.fonts?.length)) return ok(undefined);
  const declared = declaredFonts(fonts);
  if (!declared.ok) return declared;
  const bound = bindings(entries, declared.value);
  if (!bound.ok) return bound;
  const { faces, used, definitionFonts } = bound.value;
  const shas = [...used.keys()].sort();
  const fontOf = (sha: string) => declared.value.get(sha) as ImportedPackFont;
  return ok({
    fontResources: shas.map((sha) => ({
      id: resourceId(sha),
      sha256: sha,
      size: fontOf(sha).bytes.byteLength,
      mime: 'font/woff2' as const,
      profile: 'inter-latin-400-ascii' as const,
      path: `fonts/${sha}.woff2`,
    })),
    fontFaces: faces,
    definitionFonts,
    fontCredits: shas.map((sha) => {
      const { license, attribution, notice, source } = fontOf(sha);
      return { id: resourceId(sha), license, attribution, notice, source, resourceIds: [resourceId(sha)], definitionIds: used.get(sha) ?? [] };
    }),
    bytes: new Map(shas.map((sha) => [sha, fontOf(sha).bytes])),
  });
}

/** Why scoped `credits` do not cover every entry exactly once, or undefined when they do (or are absent). */
function coverage(entries: readonly ImportedPackEntry[], credits: readonly ShapePackCredit[] | undefined): Diagnostic | undefined {
  if (credits === undefined) return undefined;
  const count = new Map(entries.map((e) => [e.definition.id as string, 0]));
  for (const [i, c] of credits.entries()) {
    if (!c.definitionIds?.length) return problem(`/credits/${i}/definitionIds`, `credit ${c.id} names no definitions`);
    for (const id of c.definitionIds) {
      const seen = count.get(id);
      if (seen === undefined) return problem(`/credits/${i}/definitionIds`, `credit ${c.id} names ${id}, which is not an entry`);
      count.set(id, seen + 1);
    }
  }
  const [id, n] = [...count].find(([, n]) => n !== 1) ?? [];
  return id === undefined ? undefined : problem('/credits', `${id} is covered by ${n} credits; each entry needs exactly one`);
}

/**
 * Index imported definitions as a declarative pack with one credit covering all of them (or scoped `credits`), through the shared
 * encoder (`encodeShapePack`, ADR-0196) that first-party packs use. Refuses an empty set, IDs outside the
 * namespace and rights the content policy does not permit; nothing is partial. Entries whose text needs exact
 * fonts make the pack a 1.1 (ADR-0192) that carries each font's bytes, face and declared rights from `fonts`; a
 * needed font that is not supplied, not a supported profile or not under a supported font license is refused.
 *
 * Provenance and licence are the caller's declaration: an SVG or draw.io import states them from what the
 * user declares (their own drawing, or a named upstream with its SPDX licence), and `iconifyShapePack` derives
 * them from the collection's metadata. They are declarations, not ownership checks.
 * @public
 */
export function importedShapePack(options: ImportedPackOptions): Result<ImportedPack, readonly Diagnostic[]> {
  const fonts = draftFonts(options.entries, options.fonts ?? []);
  if (!fonts.ok) return fonts;
  const scoped = coverage(options.entries, options.credits);
  if (scoped !== undefined) return err([scoped]);
  const credit: ShapePackCredit = { id: 'source', license: options.license, attribution: options.attribution, notice: options.notice, source: options.source };
  const encoded = encodeShapePack(
    {
      id: options.namespace,
      version: options.version,
      name: options.name,
      license: options.license,
      attribution: options.attribution,
      credits: options.credits ?? [credit],
      definitions: options.entries.map((entry) => ({ name: entry.name, def: entry.definition })),
      ...(fonts.value === undefined ? {} : { fonts: fonts.value }),
    },
    options.licensePolicy,
  );
  if (!encoded.ok) return err(encoded.error.map((d) => ({ ...d, path: entryPath(d.path) })));
  const { index, definitions, files } = encoded.value;
  const categories = new Map([...files].filter(([path]) => path.startsWith('categories/')));
  const fontFiles = new Map([...files].filter(([path]) => path.startsWith('fonts/')));
  return ok({ index, categories, fontFiles, files, source: { kind: 'distribution', index, definitions, fonts: new Map(fonts.value?.bytes ?? []) } });
}

/** Version from the source: callers may pin one; otherwise the source hash keeps distinct sources distinct. */
const versionOf = (sha256: string, version: string | undefined): string => version ?? `0.0.0+sha256.${sha256.slice(0, 16)}`;

/**
 * An imported Iconify collection as a pack: every accepted icon (hidden ones too, since documents may use them),
 * credited from the collection's declared name, author and SPDX license and pinned to its source hash. A
 * collection without a declared license cannot be saved portably. Icons whose text needs exact fonts take them, with
 * their declared rights, from `fonts` and make the pack a 1.1 (ADR-0192). Declared rights are not ownership checks.
 * @public
 */
export function iconifyShapePack(
  report: IconifyImportReport,
  options: Pick<ImportedPackOptions, 'licensePolicy' | 'fonts'> & { readonly version?: string },
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
