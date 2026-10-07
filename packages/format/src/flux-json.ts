// The `.flux.json` variant (FR-FIL-005; architecture/08 §4): the document as one canonical, pretty JSON text for diffs and git,
// byte-identical for an identical document. Records go through `serializeDocument` (sorted keys, geometry to 1e-3, `-0` as `0`, every
// other number exact); the wrapper through `canonicalJson`. Assets are inline base64, or with `assets: 'external'` files
// `<name>.assets/<sha256>.<ext>` beside the JSON, so a diff shows only the hash that changed.
import { type DocumentFile, err, ok, parseDocument, type Result, serializeDocument } from '@fluxion/schema';
import { decodeBase64, encodeBase64 } from './base64.js';
import { canonicalJson } from './canonical-json.js';
import { type ContentHasher, extensionOf, FLUX_FORMAT_VERSION, type FluxAsset, themeTokens } from './flux-writer.js';
import { unsafeName } from './paths.js';
import { sha256Hex } from './sha256.js';

/**
 * What to write as `.flux.json`.
 *
 * @public
 */
export type WriteFluxJsonInput = {
  /** The document. */
  readonly document: DocumentFile;
  /** The assets, keyed by the SHA-256 their records carry; a key that is not the bytes' hash is refused. */
  readonly assets?: ReadonlyMap<string, FluxAsset>;
  /** The FluxScript the document was compiled from. */
  readonly source?: string;
  /** The version of the program writing the file. */
  readonly appVersion: string;
  /** Who made the file. */
  readonly generator?: string;
  /** `inline` (default): base64 in the JSON; `external`: files beside it. */
  readonly assetsMode?: 'inline' | 'external';
  /** The file name without `.flux.json`, for the external assets folder (default `document`). */
  readonly name?: string;
  /** Hashes the assets to check their keys. */
  readonly hasher: ContentHasher;
};

/**
 * Why a `.flux.json` could not be written or read.
 *
 * @public
 */
export type FluxJsonFailure = {
  /** One line naming the problem. */
  readonly reason: string;
};

/**
 * A file to write next to a `.flux.json`.
 *
 * @public
 */
export type FluxJsonFile = {
  /** Its path relative to the JSON. */
  readonly path: string;
  /** Its bytes. */
  readonly bytes: Uint8Array;
};

/**
 * A written `.flux.json`: its text and, with external assets, the files to write beside it.
 *
 * @public
 */
export type FluxJsonOutput = {
  /** The JSON text. */
  readonly text: string;
  /** Files to write next to the JSON, by relative path (empty with inline assets). */
  readonly files: readonly FluxJsonFile[];
};

type AssetOut = { mime: string; base64?: string; path?: string; ext?: string };

/** `{ ext }` when `asset` names an extension its media type does not imply, else nothing: a round trip keeps the asset's file name. */
const ownExt = (asset: FluxAsset): { ext?: string } =>
  // only an extension the reader takes back (lower-case letters and digits) is written; any other falls back to the media type's
  asset.ext === undefined || asset.ext === extensionOf(asset.mime) || !/^[a-z0-9]+$/.test(asset.ext) ? {} : { ext: asset.ext };

/** The extension an entry read back carries: from its external path, else its inline `ext`. */
function entryExt(entry: Raw): string | undefined {
  if (typeof entry['path'] === 'string') return /\.([a-z0-9]+)$/.exec(entry['path'])?.[1];
  return typeof entry['ext'] === 'string' && /^[a-z0-9]+$/.test(entry['ext']) ? entry['ext'] : undefined;
}

/** The external assets folder, `<name>.assets`; a name the reader would refuse is refused (M12.15 review r2 F1). */
function assetsFolder(input: WriteFluxJsonInput): Result<string, FluxJsonFailure> {
  const name = input.name ?? 'document';
  if (input.assetsMode === 'external' && !/^[^/\\:.][^/\\:]*$/.test(name))
    return err({ reason: `"${name}" cannot name an assets folder: it starts with "." or has "/", "\\" or ":"` });
  return ok(`${name}.assets`);
}

/** The assets section and the files beside the JSON, sorted by hash; a key that is not its bytes' hash is a failure. */
async function assetsOut(
  input: WriteFluxJsonInput,
): Promise<Result<{ assets: { [hash: string]: AssetOut }; files: FluxJsonOutput['files'] }, FluxJsonFailure>> {
  const folder = assetsFolder(input);
  if (!folder.ok) return folder;
  const assets: { [hash: string]: AssetOut } = {};
  const files: { path: string; bytes: Uint8Array }[] = [];
  for (const key of [...(input.assets?.keys() ?? [])].sort()) {
    const asset = input.assets?.get(key) as FluxAsset;
    const actual = await input.hasher.sha256(asset.bytes);
    if (actual !== key) return err({ reason: `the asset ${key} has the hash ${actual}` });
    if (input.assetsMode !== 'external') {
      assets[key] = { mime: asset.mime, base64: encodeBase64(asset.bytes), ...ownExt(asset) };
      continue;
    }
    const path = `${folder.value}/${key}.${ownExt(asset).ext ?? extensionOf(asset.mime)}`;
    files.push({ path, bytes: asset.bytes });
    assets[key] = { mime: asset.mime, path };
  }
  return ok({ assets, files });
}

/**
 * Write a document as `.flux.json`. The same input gives the same bytes.
 *
 * @public
 */
export async function writeFluxJson(input: WriteFluxJsonInput): Promise<Result<FluxJsonOutput, FluxJsonFailure>> {
  const out = await assetsOut(input);
  if (!out.ok) return out;
  const { assets, files } = out.value;
  // the records as serializeDocument writes them (geometry rounded), read back so the wrapper sorts and indents them once
  const { records, schemaVersion } = JSON.parse(serializeDocument(input.document)) as { records: unknown; schemaVersion: string };
  const tokens = themeTokens(input.document);
  const file = {
    fluxion: FLUX_FORMAT_VERSION,
    schemaVersion,
    manifest: { app: { name: 'fluxion', version: input.appVersion }, ...(input.generator === undefined ? {} : { generator: input.generator }) },
    records,
    ...(tokens === undefined ? {} : { theme: tokens }),
    ...(input.source === undefined ? {} : { source: input.source }),
    ...(Object.keys(assets).length === 0 ? {} : { assets }),
  };
  return ok({ text: canonicalJson(file), files });
}

/**
 * A read `.flux.json`.
 *
 * @public
 */
export type ReadFluxJson = {
  /** The document, migrated and checked as the loader does. */
  readonly document: DocumentFile;
  /** The FluxScript source, when the file carries one. */
  readonly source?: string;
  /** The assets by hash. */
  readonly assets: ReadonlyMap<string, FluxAsset>;
};

type Raw = { readonly [key: string]: unknown };
const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The only external path an asset may have: `<name>.assets/<its hash>.<ext>`, one folder deep, beside the JSON (security.md §1.7). */
const safeAssetPath = (path: string, hash: string): boolean => {
  const m = /^([^/\\:]+)\.assets\/([0-9a-f]{64})\.([a-z0-9]+)$/.exec(path);
  return m !== null && m[2] === hash && !m[1]?.startsWith('.') && unsafeName(path) === undefined;
};

/** One asset entry's bytes: inline base64, or the external file `readFile` gives for its path; the bytes must hash to the key. */
function assetBytes(hash: string, entry: Raw, readFile: (path: string) => Uint8Array | undefined): Result<Uint8Array, FluxJsonFailure> {
  let bytes: Uint8Array | undefined;
  if (typeof entry['base64'] === 'string') {
    bytes = decodeBase64(entry['base64']);
    if (!bytes) return err({ reason: `the asset ${hash} is not valid base64` });
  } else {
    const path = entry['path'];
    if (typeof path !== 'string' || !safeAssetPath(path, hash))
      return err({ reason: `the asset ${hash} has no inline bytes and no safe path (<name>.assets/<hash>.<ext>)` });
    bytes = readFile(path);
    if (!bytes) return err({ reason: `the asset file ${path} is missing` });
  }
  // content-addressed: bytes that changed under the same key are refused, as the .flux loader refuses them (ASSET_HASH_MISMATCH)
  const actual = sha256Hex(bytes);
  return actual === hash ? ok(bytes) : err({ reason: `the asset ${hash} has the hash ${actual}` });
}

/** The assets section read into bytes by hash. */
function assetsIn(section: unknown, readFile: (path: string) => Uint8Array | undefined): Result<Map<string, FluxAsset>, FluxJsonFailure> {
  const assets = new Map<string, FluxAsset>();
  for (const [hash, entry] of Object.entries(isObject(section) ? section : {})) {
    if (!isObject(entry) || typeof entry['mime'] !== 'string') return err({ reason: `the asset ${hash} has no media type` });
    const bytes = assetBytes(hash, entry, readFile);
    if (!bytes.ok) return bytes;
    const ext = entryExt(entry);
    assets.set(hash, { bytes: bytes.value, mime: entry['mime'], ...(ext === undefined || ext === extensionOf(entry['mime']) ? {} : { ext }) });
  }
  return ok(assets);
}

/**
 * Read a `.flux.json` text; `readFile` gives the bytes of an external asset by its relative path. Never throws.
 *
 * @public
 */
export function readFluxJson(text: string, readFile: (path: string) => Uint8Array | undefined = () => undefined): Result<ReadFluxJson, FluxJsonFailure> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return err({ reason: 'the file is not JSON' });
  }
  if (!isObject(raw) || typeof raw['fluxion'] !== 'string') return err({ reason: 'the file is not a .flux.json (no "fluxion" version)' });
  const parsed = parseDocument(JSON.stringify({ schemaVersion: raw['schemaVersion'], records: raw['records'] }));
  if (!parsed.ok) return err({ reason: parsed.error.message });
  const assets = assetsIn(raw['assets'], readFile);
  if (!assets.ok) return assets;
  return ok({ document: parsed.value.document, ...(typeof raw['source'] === 'string' ? { source: raw['source'] } : {}), assets: assets.value });
}
