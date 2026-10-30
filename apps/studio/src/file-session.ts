// Files in the studio (FR-FIL-006, NFR-REL-001, M10.17): what a file the person opens is, what the studio may do with it, and the bytes a save
// writes. The decisions are here, apart from the browser APIs that move the bytes (file-host.ts): a `.flux`, `.flux.html` or `.flux.json` opens
// to a document and its assets; a file written by a newer major version (`readOnly`) or opened in part (`salvage`) is never saved over its
// own file, only as a copy; and only a `.flux` is saved over, since the others are different formats.
import { allowsShapePackContentLicense, artworkFontRequirements, type FileIO, type VersionedShapePackSubset } from '@fluxion/core';
import {
  type ContentHasher,
  createMemoryAssetStore,
  embedExternalAssets,
  type FluxAsset,
  type FontSubsetDeps,
  type FontSubsetLine,
  glyphInventory,
  type LoadNote,
  loadFlux,
  openDocumentText,
  readFluxHtml,
  type Salvage,
  type ShapePackSourceData,
  type SubsetSave,
  selectAssets,
  sha256Hex,
  subsetFontGaps,
  subsetFontsForSave,
  writePortableFlux,
} from '@fluxion/format';
import { type AnyRecord, type Diagnostic, type DocumentFile, err, ok, type Result } from '@fluxion/schema';
import { shapeSaveOptions, unresolvedShapeIds } from './file-shapes.js';

/**
 * The kinds of file the studio opens.
 *
 * @public
 */
export type FileKind = 'flux' | 'flux.html' | 'flux.json';

/**
 * A file the studio opened: its document and assets, and what must come back when it is saved.
 *
 * @public
 */
export type OpenedFile = {
  /** The file's name, as the person knows it. */
  readonly name: string;
  /** What kind of file it was. */
  readonly kind: FileKind;
  /** The document as opened (the store holds the edited one). */
  readonly document: DocumentFile;
  /** The assets the file held, by hash. */
  readonly assets: ReadonlyMap<string, FluxAsset>;
  /** True when it must not be saved over (a newer major version, or a cut-off file of unknown version). */
  readonly readOnly: boolean;
  /** Present when it was opened in part. */
  readonly salvage?: Salvage;
  /** What the loader found wrong with the container, to show. */
  readonly notes: readonly LoadNote[];
  /** The FluxScript source the file kept, handed back on a save. */
  readonly source?: string;
  /** Entries the studio does not interpret, handed back on a save so they survive. */
  readonly extraEntries: ReadonlyMap<string, Uint8Array>;
  /** Manifest fields the studio does not know, handed back on a save. */
  readonly manifestExtras: { readonly [key: string]: unknown };
  /** Original opaque plugin locks, retained through saves. */
  readonly plugins?: readonly unknown[];
  /** Validated embedded geometry and complete source credits. */
  readonly shapePacks?: readonly VersionedShapePackSubset[];
  /** References unresolved at open time; never inferred from later edits. */
  readonly unresolvedShapeIds?: ReadonlySet<string>;
  /** The exact retained artwork font bytes the saved 1.1 packs bind, by SHA-256, as the loader verified them (ADR-0192). */
  readonly artworkFonts?: ReadonlyMap<string, Uint8Array>;
};

/** The retained bytes of every artwork font `packs` bind that `assets` holds, by SHA-256 (the loader rehashed them). */
function retainedArtworkFonts(packs: readonly VersionedShapePackSubset[], assets: ReadonlyMap<string, FluxAsset>): ReadonlyMap<string, Uint8Array> {
  const fonts = new Map<string, Uint8Array>();
  for (const { sha256 } of artworkFontRequirements(packs)) {
    const bytes = assets.get(sha256)?.bytes;
    if (bytes !== undefined) fonts.set(sha256, bytes);
  }
  return fonts;
}

/** The text of `bytes` as UTF-8 (the studio runs in a browser, which has TextDecoder). */
const textOf = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

/** The kind of file `bytes` is: a zip by its signature, a `.flux.html` by being markup that carries the marker in its first 4 kB, else JSON. */
export function kindOf(bytes: Uint8Array): FileKind {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return 'flux';
  const head = textOf(bytes.subarray(0, 4096))
    .replace(/^\ufeff/, '')
    .trimStart();
  // a JSON document that merely has the marker among its text starts with a brace, not a tag
  return head.startsWith('<') && head.includes('fluxion:format') ? 'flux.html' : 'flux.json';
}

/** A `.flux` archive opened. */
async function openArchive(name: string, bytes: Uint8Array, kind: FileKind, hasher: ContentHasher): Promise<Result<OpenedFile, string>> {
  const loaded = await loadFlux(bytes, { hasher, shapePackLicensePolicy: allowsShapePackContentLicense });
  if (!loaded.ok) return err(`${name} cannot be opened: ${loaded.error.message}`);
  const f = loaded.value;
  return ok({
    name,
    kind,
    document: f.document,
    assets: f.assets,
    readOnly: f.readOnly,
    ...(f.salvage === undefined ? {} : { salvage: f.salvage }),
    notes: f.notes,
    ...(f.source === undefined ? {} : { source: f.source }),
    extraEntries: f.extraEntries,
    manifestExtras: f.manifestExtras,
    plugins: f.manifest?.plugins ?? [],
    shapePacks: f.shapePacks,
    unresolvedShapeIds: unresolvedShapeIds(f.document, f.shapePacks),
    artworkFonts: retainedArtworkFonts(f.shapePacks, f.assets),
  });
}

/** A `.flux.html`: its archive found by scanning (nothing is executed), then opened like a `.flux`. */
async function openPage(name: string, bytes: Uint8Array, hasher: ContentHasher): Promise<Result<OpenedFile, string>> {
  const archive = await readFluxHtml(textOf(bytes), hasher);
  return archive.ok ? openArchive(name, archive.value, 'flux.html', hasher) : err(`${name} cannot be opened: ${archive.error.message}`);
}

/** A `.flux.json`: the document alone, perhaps in part or read-only. */
function openJson(name: string, bytes: Uint8Array): Promise<Result<OpenedFile, string>> {
  const opened = openDocumentText(textOf(bytes));
  if (!opened.ok) return Promise.resolve(err(`${name} cannot be opened: ${opened.error.message}`));
  const { document, readOnly, salvage } = opened.value;
  return Promise.resolve(
    ok({
      name,
      kind: 'flux.json',
      document,
      assets: new Map(),
      readOnly,
      ...(salvage === undefined ? {} : { salvage }),
      notes: [],
      extraEntries: new Map(),
      manifestExtras: {},
      plugins: [],
      shapePacks: [],
      unresolvedShapeIds: unresolvedShapeIds(document, []),
    }),
  );
}

/** How each kind of file is opened. */
const OPENERS: { readonly [kind in FileKind]: (name: string, bytes: Uint8Array, hasher: ContentHasher) => Promise<Result<OpenedFile, string>> } = {
  flux: (name, bytes, hasher) => openArchive(name, bytes, 'flux', hasher),
  'flux.html': openPage,
  'flux.json': (name, bytes) => openJson(name, bytes),
};

/**
 * Open the file `name` with contents `bytes`: a `.flux`, a `.flux.html` (its archive found by scanning, nothing executed) or a `.flux.json`.
 * A failure is one line for the person.
 *
 * @public
 */
export function openFileBytes(name: string, bytes: Uint8Array, hasher: ContentHasher): Promise<Result<OpenedFile, string>> {
  return OPENERS[kindOf(bytes)](name, bytes, hasher);
}

/**
 * Whether Save may write over the file it was opened from: only a whole `.flux` written by this major version. Anything else is saved as a
 * copy, never over the original (a salvaged document is not the original; a newer file's unknown parts would be lost).
 *
 * @public
 */
export const mayOverwrite = (file: OpenedFile): boolean => file.kind === 'flux' && !file.readOnly && file.salvage === undefined;

/**
 * Lines to tell the person about the file: why it can only be saved as a copy, what was left out, what is wrong with the container.
 *
 * @public
 */
export function describeFile(file: OpenedFile): string[] {
  const lines = [whyCopyOnly(file), leftOut(file), problems(file)].filter((l): l is string => l !== undefined);
  return lines.length === 0 && !mayOverwrite(file) ? [`${file.name} is a ${file.kind} file: Save writes a new .flux and leaves it as it is.`] : lines;
}

/** Why the file can only be saved as a copy, when it is because of what it is. */
function whyCopyOnly(file: OpenedFile): string | undefined {
  if (file.salvage?.reason === 'newer-major')
    return `${file.name} was written by a newer version of Fluxion: it opens read-only and can only be saved as a copy.`;
  if (file.salvage?.reason === 'truncated') return `${file.name} was cut off: what could be read is open, and it can only be saved as a copy.`;
  return file.readOnly ? `${file.name} is read-only here and can only be saved as a copy.` : undefined;
}

const leftOut = (file: OpenedFile): string | undefined =>
  file.salvage !== undefined && file.salvage.dropped.length > 0 ? `${file.salvage.dropped.length} damaged records were left out.` : undefined;

const problems = (file: OpenedFile): string | undefined =>
  file.notes.length > 0
    ? `${file.notes.length} problems with the file: ${file.notes
        .slice(0, 3)
        .map((n) => n.message)
        .join('; ')}`
    : undefined;

/**
 * What a save writes.
 *
 * @public
 */
export type SavedBytes = {
  /** The `.flux` file's bytes. */
  readonly bytes: Uint8Array;
  /** Assets the document refers to whose bytes could not be found (the file is still written; the person is told). */
  readonly missing: number;
  /** External images that could not be embedded (their fetch failed, or they are not images) and so still need the network; 0 when embedding is off. */
  readonly external: number;
  /** Portable-save warnings that the host must display before claiming success. */
  readonly diagnostics: readonly Diagnostic[];
  /** What subset-on-save did with each font; empty when the option is off. */
  readonly fonts: readonly FontSubsetLine[];
  /** Subset fonts the document's text has outgrown: characters each no longer draws (the original font is needed for them). */
  readonly fontGaps: readonly { readonly name: string; readonly missing: readonly number[] }[];
};

/**
 * What a save needs.
 *
 * @public
 */
export type SaveInput = {
  /** The file the document was opened from, if any (its source, entries and manifest fields come back). */
  readonly file: OpenedFile | undefined;
  /** Explicit SDK-resolved geometry and provenance for new namespaces; loaded namespaces cannot be replaced. */
  readonly shapePackSources?: readonly ShapePackSourceData[];
  /** The document to write. */
  readonly document: DocumentFile;
  /** The bytes the editor holds for an asset record (pasted, replaced or added images and fonts), by the record's id. */
  readonly bytesOf: (assetId: string) => Promise<FluxAsset | undefined>;
  /** Hashes the entries. */
  readonly hasher: ContentHasher;
  /** The version of the studio, for the manifest. */
  readonly appVersion: string;
  /** Where to read external images from when the save embeds them (FR-AST-006); absent when embedding is off. */
  readonly embedExternal?: Pick<FileIO, 'read'>;
  /** The font asset records and bytes to add to the saved document (the bundled fonts its text uses); the live document is not changed. */
  readonly fonts?: (document: DocumentFile) => Promise<{ readonly records: readonly AnyRecord[]; readonly assets: ReadonlyMap<string, FluxAsset> }>;
  /** Subset-on-save (FR-AST-003, ADR-0051): how each font job runs; absent while the option is off, which writes whole fonts. */
  readonly subsetFonts?: FontSubsetDeps;
};

/** The assets of `input.document` that have bytes, by hash: those the file held, else those the editor holds. */
async function heldAssets(input: SaveInput): Promise<Map<string, FluxAsset>> {
  const byHash = new Map<string, FluxAsset>(input.file?.assets ?? []);
  const records = Object.values(input.document.records) as { id: string; type: string; hash?: string }[];
  for (const record of records.filter((r) => r.type === 'asset' && r.hash !== undefined && !byHash.has(r.hash))) {
    const held = await input.bytesOf(record.id);
    if (held !== undefined) byHash.set(record.hash as string, held);
  }
  return byHash;
}

/** The assets a save may write, by hash: those the file or the editor holds and the bundled fonts, each checked against its hash. */
async function verifiedAssets(input: SaveInput, extra: ReadonlyMap<string, FluxAsset>): Promise<Map<string, FluxAsset>> {
  const out = new Map<string, FluxAsset>();
  for (const [hash, asset] of [...(await heldAssets(input)), ...extra]) if ((await input.hasher.sha256(asset.bytes)) === hash) out.set(hash, asset);
  return out;
}

/** The subset fonts of `document` whose recorded inventory lacks characters its text now uses. */
function gapsOf(document: DocumentFile): SavedBytes['fontGaps'] {
  const inventory = glyphInventory(document);
  if (inventory.status !== 'complete') return [];
  return subsetFontGaps(document, inventory.codepoints).map((g) => ({
    name: String((document.records[g.asset] as { name?: unknown } | undefined)?.name ?? g.asset),
    missing: g.missing,
  }));
}

/** Write `document` with the assets of `byHash` it references. */
async function writeDocument(input: SaveInput, document: DocumentFile, byHash: ReadonlyMap<string, FluxAsset>): Promise<Result<SavedBytes, string>> {
  const store = createMemoryAssetStore(input.hasher);
  for (const asset of byHash.values()) await store.put(asset.bytes, asset.mime);
  const embedded = input.embedExternal
    ? await embedExternalAssets({ document, store, io: input.embedExternal, hasher: input.hasher })
    : { document, failures: [] };
  const picked = await selectAssets(embedded.document, store);
  const { file } = input;
  const written = await writePortableFlux({
    document: embedded.document,
    assets: picked.assets,
    appVersion: input.appVersion,
    generator: 'fluxion studio',
    ...(file?.source === undefined ? {} : { source: file.source }),
    ...(file === undefined ? {} : { extraEntries: file.extraEntries, manifestExtras: file.manifestExtras }),
    hasher: input.hasher,
    plugins: file?.plugins ?? [],
    shapePacks: shapeSaveOptions(file?.shapePacks ?? [], input.shapePackSources ?? [], file?.unresolvedShapeIds ?? new Set(), file?.artworkFonts),
  });
  return written.ok
    ? ok({
        bytes: written.value.bytes,
        missing: picked.missing.length,
        external: embedded.failures.length,
        diagnostics: written.value.diagnostics,
        fonts: [],
        fontGaps: gapsOf(document),
      })
    : err(`The file could not be written: ${written.error.reason}`);
}

/** Whether the written candidate reopens with every subset font's record pointing at bytes of that exact hash. */
async function reopensWithSubsets(bytes: Uint8Array, candidate: SubsetSave, hasher: ContentHasher): Promise<boolean> {
  const opened = await openFileBytes('candidate.flux', bytes, hasher);
  if (!opened.ok || opened.value.salvage !== undefined) return false;
  for (const line of candidate.report.filter((l) => l.status === 'subset')) {
    const record = opened.value.document.records[line.asset] as { hash?: string; mime?: string } | undefined;
    const held = record?.hash === undefined ? undefined : opened.value.assets.get(record.hash);
    if (held === undefined || record?.mime !== 'font/woff2' || (await hasher.sha256(held.bytes)) !== record.hash) return false;
  }
  return true;
}

/** A report whose subsets were not kept: the whole fonts were written instead. */
const unvalidated = (report: readonly FontSubsetLine[]): FontSubsetLine[] =>
  report.map((l) =>
    l.status === 'subset'
      ? {
          asset: l.asset,
          name: l.name,
          before: l.before,
          after: l.before,
          status: 'kept',
          reason: 'engine-failure',
          message: 'the saved subset did not reopen intact',
        }
      : l,
  );

/**
 * The `.flux` bytes of `input.document`: its referenced assets, the source, the entries and the manifest fields the file came with, so a
 * re-save keeps what the studio does not know. Bytes whose hash is not their record's are not that asset: they are left out and counted as
 * missing. With `subsetFonts`, eligible fonts are written as used-glyph subsets after the candidate reopens intact; otherwise, and for every
 * font that cannot be subset, the whole font is written. A failure is one line.
 *
 * @public
 */
export async function fileBytes(input: SaveInput): Promise<Result<SavedBytes, string>> {
  const extra = (await input.fonts?.(input.document)) ?? { records: [], assets: new Map<string, FluxAsset>() };
  // the fonts the studio brings are part of what is written, not of the open document
  const document: DocumentFile = { ...input.document, records: { ...input.document.records, ...Object.fromEntries(extra.records.map((r) => [r.id, r])) } };
  const byHash = await verifiedAssets(input, extra.assets);
  if (input.subsetFonts === undefined) return writeDocument(input, document, byHash);
  const candidate = await subsetFontsForSave(document, (hash) => byHash.get(hash)?.bytes, input.subsetFonts);
  if (!candidate.report.some((l) => l.status === 'subset')) {
    const whole = await writeDocument(input, document, byHash);
    return whole.ok ? ok({ ...whole.value, fonts: candidate.report }) : whole;
  }
  const subset = await writeDocument(input, candidate.document, new Map([...byHash, ...candidate.assets]));
  if (subset.ok && (await reopensWithSubsets(subset.value.bytes, candidate, input.hasher))) return ok({ ...subset.value, fonts: candidate.report });
  const whole = await writeDocument(input, document, byHash);
  return whole.ok ? ok({ ...whole.value, fonts: unvalidated(candidate.report) }) : whole;
}

/** SubtleCrypto where the page has it, else the pure SHA-256 of `format`. */
export const webHasher: ContentHasher = {
  async sha256(bytes) {
    const subtle = globalThis.crypto?.subtle;
    if (subtle === undefined) return sha256Hex(bytes);
    const digest = new Uint8Array(await subtle.digest('SHA-256', bytes.slice().buffer));
    return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
  },
};
