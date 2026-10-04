// The content-addressed asset store (FR-FIL-004, NFR-SIZE-004; architecture/08 §6): bytes keyed by their SHA-256, so the same bytes are
// held once however many records refer to them. `AssetStore` is the port; the memory store is the one the CLI, the tests and the
// studio's session use, and the studio adds an OPFS-backed one (ADR-0024, M10.18). On save only the assets the document refers to are
// written (`selectAssets`).
import type { AnyRecord, DocumentFile } from '@fluxion/schema';
import type { ContentHasher, FluxAsset } from './flux-writer.js';
import { normalise, usedFontFamilies } from './used-fonts.js';

/**
 * Holds asset bytes by the hash of the bytes.
 *
 * @public
 */
export interface AssetStore {
  /** Keep `bytes` of media type `mime`; the hash they are kept under. Putting bytes already held changes nothing. */
  put(bytes: Uint8Array, mime: string): Promise<string>;
  /** The asset under `hash`, if held. */
  get(hash: string): Promise<FluxAsset | undefined>;
  /** Whether `hash` is held. */
  has(hash: string): Promise<boolean>;
  /** Forget `hash` (nothing if it is not held). */
  delete(hash: string): Promise<void>;
  /** Every hash held, sorted. */
  hashes(): Promise<string[]>;
}

/**
 * A store in memory.
 *
 * @public
 */
export function createMemoryAssetStore(hasher: ContentHasher): AssetStore {
  const held = new Map<string, FluxAsset>();
  return {
    async put(bytes, mime) {
      const hash = await hasher.sha256(bytes);
      if (!held.has(hash)) held.set(hash, { bytes: bytes.slice(), mime });
      return hash;
    },
    get: (hash) => Promise.resolve(held.get(hash)),
    has: (hash) => Promise.resolve(held.has(hash)),
    delete: (hash) => Promise.resolve(void held.delete(hash)),
    hashes: () => Promise.resolve([...held.keys()].sort()),
  };
}

/** The places a record names an asset record (`references.ts` in `@fluxion/schema` checks the same fields). */
const ASSET_FIELDS: readonly (readonly string[])[] = [['assetId'], ['snapshotAssetId'], ['style', 'fill', 'assetId'], ['background', 'assetId']];

/** The value at `path` inside `value`, if every step is an object. */
function at(value: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>((v, key) => (typeof v === 'object' && v !== null ? (v as { readonly [k: string]: unknown })[key] : undefined), value);
}

/** Whether the font record `font` is one the text uses: its family is among `used`, or `used` is unknown (keep every font). */
function isUsedFont(font: unknown, used: ReadonlySet<string> | undefined): boolean {
  if (used === undefined) return true;
  const family = (font as { readonly family?: unknown }).family;
  return typeof family === 'string' && used.has(normalise(family));
}

/** The ids of the asset records an element or a screen names in one of the fields the schema's referential check knows. */
function namedAssetIds(records: readonly AnyRecord[]): Set<string> {
  const named = new Set<string>();
  for (const record of records.filter((r) => r.type === 'element' || r.type === 'screen')) {
    for (const path of ASSET_FIELDS) {
      const target = at(record, path);
      if (typeof target === 'string') named.add(target);
    }
  }
  return named;
}

/**
 * The ids of the asset records a document uses: those an element or a screen names in one of the fields the schema's referential check
 * knows (`assetId`, `snapshotAssetId`, a fill's `assetId`, a screen background's `assetId`), and every font asset record of a family the text
 * uses (`usedFontFamilies`; when that cannot be told, every font asset). A string that merely equals an asset's id (an index, a name) is not a
 * reference. What this leaves out is what the asset manager offers to remove, and what a save does not write.
 *
 * @public
 */
export function usedAssetIds(doc: DocumentFile): ReadonlySet<string> {
  const records = Object.values(doc.records) as readonly (AnyRecord & { readonly font?: unknown })[];
  const assets = records.filter((r) => r.type === 'asset');
  const used = usedFontFamilies(doc);
  const ids = new Set(assets.filter((a) => a.font !== undefined && isUsedFont(a.font, used)).map((a) => a.id as string));
  for (const named of namedAssetIds(records)) if (assets.some((a) => a.id === named)) ids.add(named);
  return ids;
}

/**
 * The hashes of the assets a document refers to: those of the asset records `usedAssetIds` names, sorted. An asset record nothing names is
 * not in the result.
 *
 * @public
 */
export function referencedAssetHashes(doc: DocumentFile): string[] {
  const used = usedAssetIds(doc);
  const hashes = (Object.values(doc.records) as readonly (AnyRecord & { readonly hash?: string })[])
    .filter((r) => r.type === 'asset' && r.hash !== undefined && used.has(r.id as string))
    .map((r) => r.hash as string);
  return [...new Set(hashes)].sort();
}

/**
 * What `selectAssets` found.
 *
 * @public
 */
export type SelectedAssets = {
  /** The referenced assets the store holds, by hash: what `writeFlux` takes. */
  readonly assets: ReadonlyMap<string, FluxAsset>;
  /** The referenced hashes the store does not hold: a document with a gap, to repair or report, never a crash. */
  readonly missing: readonly string[];
};

/**
 * The assets to save with `doc`: those it refers to, read from `store`. Assets the store holds but nothing refers to stay in the store
 * (so undo still finds them) and are not written.
 *
 * @public
 */
export async function selectAssets(doc: DocumentFile, store: AssetStore): Promise<SelectedAssets> {
  const assets = new Map<string, FluxAsset>();
  const missing: string[] = [];
  for (const hash of referencedAssetHashes(doc)) {
    const asset = await store.get(hash);
    if (asset === undefined) missing.push(hash);
    else assets.set(hash, asset);
  }
  return { assets, missing };
}
