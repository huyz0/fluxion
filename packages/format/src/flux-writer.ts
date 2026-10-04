// The `.flux` writer (FR-FIL-003, FR-FIL-004; architecture/08 §2): the document and what it needs as one zip, byte-identical for an
// identical document. Entries in a fixed order: `mimetype` (stored, first), `manifest.json` (every other entry's SHA-256 and size),
// `document.json` (canonical, from `serializeDocument`), `theme/tokens.json` (the document's own theme), the optional FluxScript
// source, the assets sorted by hash, the optional preview. Which assets to write is the caller's choice (M10.5 collects the referenced
// ones); the plugin and snapshot entries arrive with the plugins (M27, M19).
import { type DocumentFile, err, ok, type RecordId, type Result, serializeDocument } from '@fluxion/schema';
import { canonicalJson } from './canonical-json.js';
import { KNOWN_MANIFEST_KEYS, namesProblem } from './paths.js';
import { encodeUtf8 } from './utf8.js';
import { writeZip, type ZipFailure, type ZipInput } from './zip.js';

/**
 * Hashes bytes: the lower-case hex SHA-256. The same shape as `Hasher` of `@fluxion/core`, which hosts pass in.
 *
 * @public
 */
export type ContentHasher = {
  /** Lower-case hex SHA-256 of `bytes`. */
  sha256(bytes: Uint8Array): Promise<string>;
};

/**
 * One asset to write: its bytes and the media type its file extension comes from.
 *
 * @public
 */
export type FluxAsset = {
  /** The asset's bytes. */
  readonly bytes: Uint8Array;
  /** The media type (`image/webp`, `font/woff2`, ...): an unknown one is written as `.bin` unless `ext` is given. */
  readonly mime: string;
  /** The file extension to write it under, when it is not the one `mime` implies (a loaded file's own name is kept). */
  readonly ext?: string;
};

/**
 * What derived data a file bakes in (architecture/08 §8).
 *
 * @public
 */
export type FluxBakes = {
  /** Connector routes are cached in the document. */
  readonly routes: boolean;
  /** Static snapshots of plugin and component elements are included. */
  readonly snapshots: boolean;
};

/**
 * What to write.
 *
 * @public
 */
export type WriteFluxInput = {
  /** The document. */
  readonly document: DocumentFile;
  /** The assets to write, keyed by the SHA-256 their records carry; a key that is not the bytes' hash is refused. */
  readonly assets?: ReadonlyMap<string, FluxAsset>;
  /** The version of the program writing the file. */
  readonly appVersion: string;
  /** Who made the file, for example `fluxion-mcp 1.2 / <model>`. */
  readonly generator?: string;
  /** The FluxScript the document was compiled from, kept for regeneration. */
  readonly source?: string;
  /** The cover thumbnail, WebP, at most 640 px. */
  readonly preview?: Uint8Array;
  /**
   * Entries this writer does not know (a newer writer's, plugin bundles, snapshots), copied through unchanged and listed in the manifest;
   * the names must not be one this writer writes itself.
   */
  readonly extraEntries?: ReadonlyMap<string, Uint8Array>;
  /** Manifest fields this writer does not know, kept; a field it knows is ignored here (it writes those itself). */
  readonly manifestExtras?: { readonly [key: string]: unknown };
  /** The plugin lock of the manifest (default none); written as given. */
  readonly plugins?: readonly unknown[];
  /** What derived data the file bakes in (default none); written as given. */
  readonly bakes?: FluxBakes;
  /** Hashes entries for the manifest. */
  readonly hasher: ContentHasher;
};

/**
 * Why a document could not be written.
 *
 * @public
 */
export type FluxWriteFailure = ZipFailure;

/**
 * The media type `.flux` names `mimetype` with.
 *
 * @public
 */
export const FLUX_MIMETYPE = 'application/vnd.fluxion+zip';
/**
 * The container version this writer produces.
 *
 * @public
 */
export const FLUX_FORMAT_VERSION = '1.0';
/** The time a file carries when its document says none: fixed, so the bytes do not depend on a clock. */
const NO_TIME = '1980-01-01T00:00:00.000Z';

const EXTENSIONS: { readonly [mime: string]: string } = {
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'font/woff2': 'woff2',
  'font/ttf': 'ttf',
  'font/otf': 'otf',
  'video/mp4': 'mp4',
  'application/json': 'json',
};
/** Formats that are already compressed: stored, not deflated. */
const STORED = new Set(['webp', 'avif', 'png', 'jpg', 'gif', 'woff2', 'mp4']);

/** The fields of a record this writer reads. */
type Fields = { readonly [key: string]: unknown; readonly themeId?: unknown; readonly tokens?: unknown; readonly type?: unknown };

/** The file extension of an asset of media type `mime`. */
const extensionOf = (mime: string): string => EXTENSIONS[mime] ?? 'bin';

/** The document's `document` record. */
const documentRecordOf = (doc: DocumentFile): Fields | undefined => Object.values(doc.records).find((r) => r.type === 'document') as Fields | undefined;

/** The tokens of the document's own theme (the record `document.themeId` names), as DTCG JSON; undefined when it has none. */
function themeTokens(doc: DocumentFile): unknown {
  const themeId = documentRecordOf(doc)?.themeId;
  const theme = typeof themeId === 'string' ? (doc.records[themeId as RecordId] as Fields | undefined) : undefined;
  return theme?.type === 'theme' ? theme.tokens : undefined;
}

/** The text of a document field, or `fallback`. */
const textOf = (record: Fields | undefined, key: string, fallback: string): string => {
  const v = record?.[key];
  return typeof v === 'string' ? v : fallback;
};

/** The names the writer writes itself: an extra entry may not take one, nor an `assets/` path. */
const OWN_ENTRIES = new Set(['mimetype', 'manifest.json', 'document.json', 'theme/tokens.json', 'source/document.flux.yaml', 'preview.webp']);

/** The extra entries, sorted by name, or why one cannot be written. */
function extraEntries(input: WriteFluxInput): Result<ZipInput[], FluxWriteFailure> {
  const out: ZipInput[] = [];
  for (const name of [...(input.extraEntries?.keys() ?? [])].sort()) {
    if (OWN_ENTRIES.has(name) || name.startsWith('assets/')) return err({ reason: `${name} is an entry the writer writes itself`, kind: 'invalid' });
    if (name.endsWith('/')) return err({ reason: `${name} is a directory entry: extra entries are files`, kind: 'invalid' });
    out.push({ name, bytes: input.extraEntries?.get(name) as Uint8Array });
  }
  return ok(out);
}

/** The entries to hash and write, in order, after `mimetype` and `manifest.json`. */
function bodyEntries(input: WriteFluxInput): ZipInput[] {
  const { document: doc } = input;
  const out: ZipInput[] = [{ name: 'document.json', bytes: encodeUtf8(serializeDocument(doc)) }];
  const tokens = themeTokens(doc);
  if (tokens !== undefined) out.push({ name: 'theme/tokens.json', bytes: encodeUtf8(canonicalJson(tokens)) });
  if (input.source !== undefined) out.push({ name: 'source/document.flux.yaml', bytes: encodeUtf8(input.source) });
  return out;
}

/** The asset entries, sorted by hash, each named by the hash of its bytes; a key that is not that hash is a failure. */
async function assetEntries(input: WriteFluxInput): Promise<Result<ZipInput[], FluxWriteFailure>> {
  const out: ZipInput[] = [];
  for (const key of [...(input.assets?.keys() ?? [])].sort()) {
    const asset = input.assets?.get(key) as FluxAsset;
    const actual = await input.hasher.sha256(asset.bytes);
    if (actual !== key) return err({ reason: `the asset ${key} has the hash ${actual}`, kind: 'invalid' });
    const ext = asset.ext ?? extensionOf(asset.mime);
    out.push({ name: `assets/${key}.${ext}`, bytes: asset.bytes, method: STORED.has(ext) ? 'store' : 'deflate' });
  }
  return ok(out);
}

/**
 * Write `input` as a `.flux` zip. The same input gives the same bytes. A failure is a `reason`: an asset whose key is not its hash, or an
 * archive the zip format cannot hold.
 *
 * @public
 */
export async function writeFlux(input: WriteFluxInput): Promise<Result<Uint8Array, FluxWriteFailure>> {
  const assets = await assetEntries(input);
  if (!assets.ok) return assets;
  const extras = extraEntries(input);
  if (!extras.ok) return extras;
  const body = [...bodyEntries(input), ...assets.value, ...extras.value];
  if (input.preview !== undefined) body.push({ name: 'preview.webp', bytes: input.preview, method: 'store' });
  // the loader refuses these names, so the writer must not emit them
  const problem = namesProblem(['mimetype', 'manifest.json', ...body.map((e) => e.name)]);
  if (problem !== undefined) return err({ reason: problem, kind: 'invalid' });
  const entries: { [name: string]: { sha256: string; size: number } } = {};
  for (const e of body) entries[e.name] = { sha256: await input.hasher.sha256(e.bytes), size: e.bytes.length };
  const docRecord = documentRecordOf(input.document);
  const modified = textOf(docRecord, 'modified', textOf(docRecord, 'created', NO_TIME));
  const manifest = {
    ...Object.fromEntries(Object.entries(input.manifestExtras ?? {}).filter(([key]) => !KNOWN_MANIFEST_KEYS.has(key))),
    format: 'fluxion',
    formatVersion: FLUX_FORMAT_VERSION,
    schemaVersion: input.document.schemaVersion,
    app: { name: 'fluxion', version: input.appVersion },
    ...(input.generator === undefined ? {} : { generator: input.generator }),
    title: textOf(docRecord, 'title', ''),
    created: textOf(docRecord, 'created', modified),
    modified,
    entries,
    plugins: input.plugins ?? [],
    bakes: input.bakes ?? { routes: false, snapshots: false },
    ...(input.source === undefined ? {} : { source: 'source/document.flux.yaml' }),
    ...(input.preview === undefined ? {} : { preview: 'preview.webp' }),
  };
  return writeZip([
    { name: 'mimetype', bytes: encodeUtf8(FLUX_MIMETYPE), method: 'store' },
    { name: 'manifest.json', bytes: encodeUtf8(canonicalJson(manifest)) },
    ...body,
  ]);
}
