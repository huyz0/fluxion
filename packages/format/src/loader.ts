// The `.flux` loader (FR-FIL-009, NFR-REL-002; architecture/08 §2): sniff, unpack under limits, check paths, verify against the manifest,
// parse, migrate, repair and validate the document, collect the assets. It never throws: a file that cannot open is a `FormatError`,
// a file that opens with damage carries `notes` and the schema's `diagnostics`. A cut-off or partly invalid `document.json` is salvaged and a
// newer major version opens read-only (`document-open.ts`, M10.7); entries the loader does not know are M10.8's.
import { type Diagnostic, type DocumentFile, err, ok, type Result } from '@fluxion/schema';
import { openDocumentText, type Salvage } from './document-open.js';
import type { FormatError, LoadNote } from './errors.js';
import { type ContentHasher, FLUX_MIMETYPE, type FluxAsset, type FluxBakes } from './flux-writer.js';
import { KNOWN_MANIFEST_KEYS, namesProblem } from './paths.js';
import { checkAsset } from './sanitize-asset.js';
import { decodeUtf8 } from './utf8.js';
import { readZip, type ZipEntry, type ZipLimits } from './zip.js';

/**
 * What to open a file with.
 *
 * @public
 */
export type LoadOptions = {
  /** Hashes entries to verify the manifest and the assets. */
  readonly hasher: ContentHasher;
  /** Caps on the archive (defaults: 4096 entries, 128 MB an entry, 256 MB in all). */
  readonly limits?: ZipLimits;
};

/**
 * A `.flux` file, opened.
 *
 * @public
 */
export type LoadedFlux = {
  /** The document, migrated, repaired and validated. */
  readonly document: DocumentFile;
  /** What validation and repair found: warnings and info. */
  readonly diagnostics: readonly Diagnostic[];
  /**
   * What is wrong with the container itself: missing or wrong hashes, an unlisted entry. A hash that does not match means the bytes are not
   * what the writer wrote even when the archive's own checksums pass: callers must show these notes, never ignore them.
   */
  readonly notes: readonly LoadNote[];
  /**
   * True when the file may be shown but must not be saved over: it was written by a newer major version (NFR-PORT-003), or a cut-off
   * file whose schema version is unknown. The format package cannot stop a caller from writing; hosts must honour this flag (and offer
   * "save as a copy" for a `salvage`d document, which is not the original).
   */
  readonly readOnly: boolean;
  /** Present when the document was opened in part: why, and the records left out (FR-FIL-009). */
  readonly salvage?: Salvage;
  /** The FluxScript the document was compiled from, if the file keeps it. */
  readonly source?: string;
  /** The cover thumbnail, if the file has one. */
  readonly preview?: Uint8Array;
  /** Entries the loader does not interpret (a newer writer's, plugin bundles, snapshots): hand them back to `writeFlux` and they survive a re-save. */
  readonly extraEntries: ReadonlyMap<string, Uint8Array>;
  /** The manifest: what the file says about itself (`undefined` when it has none or it is unreadable). */
  readonly manifest?: LoadedManifest;
  /** Manifest fields the loader does not know, to hand back to `writeFlux` so a re-save keeps them. */
  readonly manifestExtras: { readonly [key: string]: unknown };
  /** The assets, by the hash their file name carries (verified against their bytes). */
  readonly assets: ReadonlyMap<string, FluxAsset>;
};

/**
 * What the manifest says about the file that a re-save needs.
 *
 * @public
 */
export type LoadedManifest = {
  /** The version of the program that wrote the file. */
  readonly appVersion?: string;
  /** Who made the file. */
  readonly generator?: string;
  /** The container version. */
  readonly formatVersion?: string;
  /** The document schema version. */
  readonly schemaVersion?: string;
  /** The plugin lock the manifest lists (written back unchanged). */
  readonly plugins?: readonly unknown[];
  /** What derived data the file bakes in (written back unchanged). */
  readonly bakes?: FluxBakes;
};

/** The entries the loader reads itself: they are not extras. */
const KNOWN_ENTRIES = new Set(['mimetype', 'manifest.json', 'document.json', 'theme/tokens.json', 'source/document.flux.yaml', 'preview.webp']);

const DEFAULT_LIMITS: Required<ZipLimits> = { maxEntries: 4096, maxEntryBytes: 128 * 1024 * 1024, maxTotalBytes: 256 * 1024 * 1024 };
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const ASSET_PATH = /^assets\/([0-9a-f]{64})\.([a-z0-9]+)$/;
const MIME_OF: { readonly [ext: string]: string } = {
  webp: 'image/webp',
  avif: 'image/avif',
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp4: 'video/mp4',
  json: 'application/json',
};

const fail = (code: FormatError['code'], message: string): Result<never, FormatError> => err({ code, message });

/** The first problem with the names of `entries` (unsafe, or colliding once case and Unicode form are ignored), as a failure message. */
const pathProblem = (entries: readonly ZipEntry[]): string | undefined => namesProblem(entries.map((e) => e.name));

type Listed = { readonly [name: string]: { readonly sha256?: unknown } | undefined };

/** The manifest as parsed: the fields the loader reads, and any others. */
type RawManifest = {
  readonly [key: string]: unknown;
  readonly app?: unknown;
  readonly generator?: unknown;
  readonly formatVersion?: unknown;
  readonly schemaVersion?: unknown;
  readonly plugins?: unknown;
  readonly bakes?: unknown;
};

/** What the loader reads of the manifest: the entries table, and the schema version it names. */
type ManifestInfo = { readonly entries: Listed; readonly schemaVersion?: string; readonly raw: RawManifest };

/** The manifest's entries table and schema version, or notes that it is missing or unreadable. */
function manifestOf(entries: readonly ZipEntry[], notes: LoadNote[]): ManifestInfo | undefined {
  const raw = entries.find((e) => e.name === 'manifest.json');
  if (raw === undefined) {
    notes.push({ code: 'MANIFEST_MISSING', entry: 'manifest.json', message: 'the file has no manifest.json, so its entries cannot be checked' });
    return undefined;
  }
  try {
    const parsed = JSON.parse(decodeUtf8(raw.bytes)) as { readonly entries?: unknown; readonly schemaVersion?: unknown } | null;
    const table = typeof parsed === 'object' && parsed !== null ? parsed.entries : undefined;
    if (typeof table === 'object' && table !== null && !Array.isArray(table)) {
      const version = typeof parsed?.schemaVersion === 'string' ? parsed.schemaVersion : undefined;
      return { entries: table as Listed, raw: parsed as RawManifest, ...(version === undefined ? {} : { schemaVersion: version }) };
    }
  } catch {
    // reported below
  }
  notes.push({ code: 'MANIFEST_INVALID', entry: 'manifest.json', message: 'manifest.json is not a manifest with an entries table' });
  return undefined;
}

/** The hash of an entry, computed once however many checks ask. */
type HashOf = (entry: ZipEntry) => Promise<string>;

/** A `HashOf` over `hasher` that remembers each entry's hash. */
function cachedHash(hasher: ContentHasher): HashOf {
  const known = new Map<string, Promise<string>>();
  return (entry) => {
    const hit = known.get(entry.name);
    if (hit !== undefined) return hit;
    const fresh = hasher.sha256(entry.bytes);
    known.set(entry.name, fresh);
    return fresh;
  };
}

/** Compare each entry with the manifest's table: unlisted, listed with another hash, or listed and absent. */
async function verifyEntries(entries: readonly ZipEntry[], listed: Listed, hashOf: HashOf): Promise<LoadNote[]> {
  const notes: LoadNote[] = [];
  const present = new Set(entries.map((e) => e.name));
  for (const e of entries) {
    if (e.name === 'mimetype' || e.name === 'manifest.json' || e.name.endsWith('/')) continue;
    const want = listed[e.name]?.sha256;
    if (want === undefined) notes.push({ code: 'ENTRY_UNLISTED', entry: e.name, message: `${e.name} is not in the manifest` });
    else if (want !== (await hashOf(e))) notes.push({ code: 'ENTRY_HASH_MISMATCH', entry: e.name, message: `${e.name} does not match the manifest's hash` });
  }
  for (const name of Object.keys(listed))
    if (!present.has(name)) notes.push({ code: 'ENTRY_MISSING', entry: name, message: `${name} is in the manifest but not in the file` });
  return notes;
}

/** The assets of `entries`: each kept under the hash of its bytes; a name that is not `assets/<hash>.<ext>` or bytes that do not match are notes. */
async function collectAssets(entries: readonly ZipEntry[], hashOf: HashOf, notes: LoadNote[]): Promise<Map<string, FluxAsset>> {
  const assets = new Map<string, FluxAsset>();
  for (const e of entries.filter((x) => x.name.startsWith('assets/') && !x.name.endsWith('/'))) {
    const m = ASSET_PATH.exec(e.name);
    if (m === null)
      notes.push({
        code: 'ASSET_NAME_INVALID',
        entry: e.name,
        message: `${e.name} is not assets/<sha256>.<ext>, so it is not kept when the file is saved again`,
      });
    else if ((await hashOf(e)) !== m[1]) notes.push({ code: 'ASSET_HASH_MISMATCH', entry: e.name, message: `${e.name} is not the bytes its name says` });
    else {
      const asset: FluxAsset = { bytes: e.bytes, mime: MIME_OF[m[2] as string] ?? 'application/octet-stream', ext: m[2] as string };
      assets.set(m[1] as string, asset);
      const check = checkAsset(asset);
      if (check !== 'clean') notes.push({ code: 'ASSET_UNSAFE', entry: e.name, message: unsafeMessage(e.name, check) });
    }
  }
  return assets;
}

/** The note's text for an SVG asset that is not clean. */
const unsafeMessage = (name: string, check: 'changed' | 'refused'): string =>
  check === 'changed' ? `${name} holds markup that is removed before it is drawn` : `${name} cannot be drawn: it is too large or not an SVG`;

/** The text of the entry `name`, if present. */
const textOfEntry = (entries: readonly ZipEntry[], name: string): string | undefined => {
  const e = entries.find((x) => x.name === name);
  return e === undefined ? undefined : decodeUtf8(e.bytes);
};

/** The fields of the manifest a re-save carries back, when they have the expected type. */
function manifestInfo(raw: RawManifest): LoadedManifest {
  const app = raw.app as { readonly version?: unknown } | undefined;
  const bakes = raw.bakes as { readonly routes?: unknown; readonly snapshots?: unknown } | undefined;
  const text = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  const fields: { [K in keyof LoadedManifest]: LoadedManifest[K] | undefined } = {
    appVersion: text(app?.version),
    generator: text(raw.generator),
    formatVersion: text(raw.formatVersion),
    schemaVersion: text(raw.schemaVersion),
    plugins: Array.isArray(raw.plugins) ? (raw.plugins as readonly unknown[]) : undefined,
    bakes: typeof bakes?.routes === 'boolean' && typeof bakes.snapshots === 'boolean' ? { routes: bakes.routes, snapshots: bakes.snapshots } : undefined,
  };
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as LoadedManifest;
}

/** What a re-save needs besides the document and the assets: the source, the preview, the entries and manifest fields the loader does not know. */
function restOf(
  entries: readonly ZipEntry[],
  manifest: ManifestInfo | undefined,
): Pick<LoadedFlux, 'extraEntries' | 'manifestExtras' | 'manifest'> & { source?: string; preview?: Uint8Array } {
  const source = textOfEntry(entries, 'source/document.flux.yaml');
  const preview = entries.find((e) => e.name === 'preview.webp')?.bytes;
  const extraEntries = new Map(
    entries.filter((e) => !KNOWN_ENTRIES.has(e.name) && !e.name.startsWith('assets/') && !e.name.endsWith('/')).map((e) => [e.name, e.bytes]),
  );
  const raw: RawManifest = manifest?.raw ?? {};
  const manifestExtras = Object.fromEntries(Object.entries(raw).filter(([key]) => !KNOWN_MANIFEST_KEYS.has(key)));
  return {
    extraEntries,
    manifestExtras,
    ...(manifest ? { manifest: manifestInfo(raw) } : {}),
    ...(source === undefined ? {} : { source }),
    ...(preview === undefined ? {} : { preview }),
  };
}

/** The unpacked `entries`, opened as a document. */
async function openEntries(entries: readonly ZipEntry[], hasher: ContentHasher): Promise<Result<LoadedFlux, FormatError>> {
  const problem = pathProblem(entries);
  if (problem !== undefined) return fail('FILE_PATH_UNSAFE', problem);
  const mime = entries.find((e) => e.name === 'mimetype');
  if (mime === undefined || decodeUtf8(mime.bytes).trim() !== FLUX_MIMETYPE)
    return fail('FILE_NOT_FLUX', 'the archive is not a .flux file: no mimetype entry naming it');
  const document = entries.find((e) => e.name === 'document.json');
  if (document === undefined) return fail('FILE_DOCUMENT_MISSING', 'the archive has no document.json');
  const notes: LoadNote[] =
    entries[0]?.name === 'mimetype' ? [] : [{ code: 'MIMETYPE_NOT_FIRST', entry: 'mimetype', message: 'mimetype is not the first entry' }];
  const manifest = manifestOf(entries, notes);
  const listed = manifest?.entries;
  const hashOf = cachedHash(hasher);
  if (listed !== undefined) notes.push(...(await verifyEntries(entries, listed, hashOf)));
  const opened = openDocumentText(decodeUtf8(document.bytes), manifest?.schemaVersion);
  if (!opened.ok) return opened;
  const { document: doc, diagnostics, readOnly, salvage } = opened.value;
  const assets = await collectAssets(entries, hashOf, notes);
  return ok({ document: doc, diagnostics, notes, readOnly, ...(salvage ? { salvage } : {}), assets, ...restOf(entries, manifest) });
}

/**
 * Open the `.flux` file `bytes`. Never throws: a file that cannot open is an error with a stable code; one that opens with damage carries
 * `notes` and `diagnostics`.
 *
 * @public
 */
export async function loadFlux(bytes: Uint8Array, options: LoadOptions): Promise<Result<LoadedFlux, FormatError>> {
  try {
    if (!ZIP_MAGIC.every((b, i) => bytes[i] === b)) return fail('FILE_NOT_FLUX', 'the file is not a zip archive');
    const zip = readZip(bytes, { ...DEFAULT_LIMITS, ...options.limits });
    if (!zip.ok) return fail(zip.error.kind === 'limit' ? 'FILE_TOO_LARGE' : 'FILE_ZIP_INVALID', zip.error.reason);
    return await openEntries(zip.value, options.hasher);
  } catch (e) {
    return fail('FILE_INTERNAL', `the loader failed on this file: ${e instanceof Error ? e.message : String(e)}`);
  }
}
