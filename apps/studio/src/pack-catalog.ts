// The first-party shape packs in the studio's library (FR-LIB-007, FR-LIB-009, M18.32): every pack's index is read and
// verified up front, so the library lists and searches all of them by the names their indexes give; a definition's
// category is fetched, hash-checked and registered only when it is picked, dropped or already used by the open document.
// What a document loaded is what its save embeds (`sources`). A namespace the opened file brought its own saved geometry
// for is left to that geometry: installed and saved versions never mix (ADR-0183). A pack's `connectors.json` is read with its
// index, and its connector types are registered into each open document's routers, so they can be chosen before any save
// (M18.251); a namespace whose types the opened file embeds is left to the file's, by the same rule.
import {
  allowsShapePackContentLicense,
  type ConnectorDef,
  type Disposable,
  type Hasher,
  type Registry,
  type ShapeDef,
  type VersionedShapePackSubset,
} from '@fluxion/core';
import { entriesOfIndex, entriesOfSubset, type LibraryCatalog, type LibraryEntry } from '@fluxion/editor';
import type { ShapePackSourceData } from '@fluxion/format';
import { type Router, registerConnectorDefs } from '@fluxion/routing';
import { createShapePackLoader, loadPackConnectors, type ShapePackLoader } from '@fluxion/sdk';

/** A pack file read as text, by its path in the studio's dependencies. */
type Files = Readonly<Record<string, () => Promise<string>>>;

declare global {
  interface ImportMeta {
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default' }): Record<string, () => Promise<string>>;
  }
}

/**
 * Each first-party pack's index and category files, fetched on demand, read through the studio's listed pack dependencies
 * (ADR-0017, ADR-0200); the bundled basic pack's index is included for its names.
 */
const INDEXES: Files = import.meta.glob('../node_modules/@fluxion/pack-*/pack/index.json', { query: '?raw', import: 'default' });
const CATEGORIES: Files = import.meta.glob('../node_modules/@fluxion/pack-*/pack/categories/*.json', { query: '?raw', import: 'default' });
/** Each first-party pack's `connectors.json`, for the packs that have one (M18.250). */
const CONNECTORS: Files = import.meta.glob('../node_modules/@fluxion/pack-*/pack/connectors.json', { query: '?raw', import: 'default' });

/** The most one index or category file may hold. */
const MAX_PACK_FILE_BYTES = 4 * 1024 * 1024;

const encoder = new TextEncoder();

/** Why `error` stopped a read, as one line. */
const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * The loader of the pack whose index is at `path`, reading its files from `categories`, or why it was refused: an index that
 * fails to read refuses its pack alone, never the catalog (M18.216, cp30 F4).
 */
async function loaderOf(path: string, read: () => Promise<string>, categories: Files, hasher: Hasher): Promise<ShapePackLoader | string> {
  let text: string;
  try {
    text = await read();
  } catch (error) {
    return `${path}: ${reason(error)}`;
  }
  const root = path.slice(0, -'index.json'.length);
  const loaded = await createShapePackLoader(encoder.encode(text), {
    maxBytes: MAX_PACK_FILE_BYTES,
    hasher,
    licensePolicy: allowsShapePackContentLicense,
    read: async (file, maxBytes) => {
      const text = categories[`${root}${file}`];
      if (text === undefined) throw new Error(`${file} is not in the pack`);
      const bytes = encoder.encode(await text());
      if (bytes.length > maxBytes) throw new Error(`${file} exceeds ${maxBytes} bytes`);
      return bytes;
    },
  });
  return loaded.ok ? loaded.value : `${path}: ${loaded.error.map((d) => d.message).join('; ')}`;
}

/**
 * A first-party pack's connector types, from its `connectors.json`.
 *
 * @public
 */
export type PackConnectors = {
  /** The pack's namespace. */
  readonly pack: string;
  /** Its connector types, validated by the SDK's `loadPackConnectors`. */
  readonly definitions: readonly ConnectorDef[];
};

/** The connector types of `loader`'s pack, read from its `connectors.json` beside the index at `path`; none without one. */
async function connectorsOf(path: string, loader: ShapePackLoader, connectors: Files): Promise<PackConnectors | string | undefined> {
  const file = `${path.slice(0, -'index.json'.length)}connectors.json`;
  const read = connectors[file];
  if (read === undefined) return undefined;
  let text: string;
  // a file that fails to read (its chunk did not load) drops only this pack's types, like an index (M18.216, M18.251 r4 F1)
  try {
    text = await read();
  } catch (error) {
    return `${file}: ${reason(error)}`;
  }
  const loaded = loadPackConnectors(encoder.encode(text), loader.index.id, MAX_PACK_FILE_BYTES);
  return loaded.ok ? { pack: loader.index.id, definitions: loaded.value } : `${file}: ${loaded.error.map((d) => d.message).join('; ')}`;
}

/**
 * The first-party packs' verified indexes, one loader each, their connector types, and the files refused (a studio bug): an
 * index refused drops its pack, a `connectors.json` refused drops only its connector types.
 *
 * @public
 */
export type PackCatalog = {
  readonly loaders: readonly ShapePackLoader[];
  readonly connectors: readonly PackConnectors[];
  readonly refused: readonly string[];
};

/** Read and verify every first-party pack index and `connectors.json` (`indexes`, `categories` and `connectors` default to the bundled ones). */
export async function loadPackCatalog(
  hasher: Hasher,
  indexes: Files = INDEXES,
  categories: Files = CATEGORIES,
  connectors: Files = CONNECTORS,
): Promise<PackCatalog> {
  const read = await Promise.all(
    Object.entries(indexes).map(async ([path, index]) => {
      const loader = await loaderOf(path, index, categories, hasher);
      return { loader, types: typeof loader === 'string' ? undefined : await connectorsOf(path, loader, connectors) };
    }),
  );
  return {
    loaders: read.flatMap(({ loader }) => (typeof loader === 'string' ? [] : [loader])),
    connectors: read.flatMap(({ types }) => (types === undefined || typeof types === 'string' ? [] : [types])),
    refused: read.flatMap(({ loader, types }) => [loader, types].filter((r): r is string => typeof r === 'string')),
  };
}

/**
 * Register `catalog`'s connector types into `routers` (an open document's) with routing's `registerConnectorDefs`, each pack
 * all or none, except the packs in `embedded` (namespaces the opened file carries its own types for). A refused pack is
 * reported to `onProblem` and its connectors drawn as an unknown type. Disposing releases what was registered.
 *
 * @public
 */
export function registerPackConnectors(
  catalog: Pick<PackCatalog, 'connectors'>,
  routers: Registry<string, Router>,
  embedded: ReadonlySet<string>,
  onProblem: (message: string) => void,
): Disposable {
  const done = catalog.connectors.flatMap(({ pack, definitions }) => {
    if (embedded.has(pack)) return [];
    const r = registerConnectorDefs(routers, { format: 'fluxion-connector-defs', formatVersion: '1.0', definitions }, pack);
    if (r.ok) return [r.value];
    onProblem(`The connector types of ${pack} could not be registered: ${r.error.map((d) => d.message).join('; ')}`);
    return [];
  });
  return {
    dispose: () => {
      for (const d of done) d.dispose();
    },
  };
}

/**
 * The catalog of one open document: the library's entries and loading into its shape registry, what its save embeds,
 * and the used definitions it loads when opened.
 *
 * @public
 */
export type DocumentCatalog = LibraryCatalog & {
  /** The packs whose definitions this document loaded, with those definitions, for its save to embed. */
  sources(): readonly ShapePackSourceData[];
  /** Load every catalog definition `defIds` names that is not registered yet; resolves to the ids that failed. */
  resolve(defIds: Iterable<string>): Promise<readonly string[]>;
  /** Every first-party pack's display name by pack id, saved namespaces included (M18.143). */
  readonly names: ReadonlyMap<string, string>;
};

/**
 * The catalog for a document whose shapes live in `defs`. Packs in `saved` (namespaces the opened file embeds) are left out.
 * A definition that fails to load is reported to `onProblem`.
 */
export function documentCatalog(
  catalog: PackCatalog,
  defs: Registry<string, ShapeDef>,
  saved: ReadonlySet<string>,
  onProblem: (message: string) => void,
): DocumentCatalog {
  const loaders = catalog.loaders.filter((l) => !saved.has(l.index.id));
  const byPack = new Map(loaders.map((l) => [l.index.id, l]));
  const loaded = new Map<string, Map<string, ShapeDef>>();
  const entries: readonly LibraryEntry[] = loaders.flatMap((l) => entriesOfIndex(l.index));
  // a namespace another library already holds (an imported SVG library, M18.17) stays that library's: a save cannot embed
  // two sources of one namespace
  const heldElsewhere = (pack: string): boolean => !loaded.has(pack) && defs.list().some(([key]) => key.startsWith(`${pack}:`));
  /** Register the loaded `def` (a pick that raced another for the same definition finds it registered) and note it for the save. */
  const keep = (id: string, def: ShapeDef, pack: string): boolean => {
    if (defs.get(id) === undefined) {
      const added = defs.register(id, def, pack);
      if (!added.ok) {
        onProblem(`The shape ${id} could not be registered: ${added.error.message}`);
        return false;
      }
    }
    const used = loaded.get(pack) ?? new Map<string, ShapeDef>();
    used.set(id, def);
    loaded.set(pack, used);
    return true;
  };
  const ensure = async (id: string): Promise<boolean> => {
    if (defs.get(id) !== undefined) return true;
    const pack = id.slice(0, id.indexOf(':'));
    const loader = byPack.get(pack);
    if (loader === undefined) return false;
    if (heldElsewhere(pack)) {
      onProblem(`The shape ${id} could not be loaded: the namespace ${pack} is held by another library`);
      return false;
    }
    const def = await loader.load(id);
    if (!def.ok) {
      onProblem(`The shape ${id} could not be loaded: ${def.error.map((d) => d.message).join('; ')}`);
      return false;
    }
    return keep(id, def.value, pack);
  };
  return {
    entries,
    ensure,
    names: new Map(catalog.loaders.map((l) => [l.index.id, l.index.name])),
    sources: () =>
      [...loaded].map(([pack, used]) => ({
        kind: 'distribution' as const,
        index: (byPack.get(pack) as ShapePackLoader).index,
        definitions: [...used.values()],
      })),
    async resolve(defIds) {
      const wanted = [...new Set(defIds)].filter((id) => defs.get(id) === undefined && byPack.has(id.slice(0, id.indexOf(':'))));
      const results = await Promise.all(wanted.map(async (id) => [id, await ensure(id)] as const));
      return results.filter(([, ok]) => !ok).map(([id]) => id);
    },
  };
}

/** The bundled catalog, read once per page on first use; a read that rejected is not kept (M18.216). */
let bundled: Promise<PackCatalog> | undefined;

/** The bundled first-party packs' catalog, verified with `hasher` the first time it succeeds. */
export function bundledPackCatalog(hasher: Hasher, read: (hasher: Hasher) => Promise<PackCatalog> = loadPackCatalog): Promise<PackCatalog> {
  bundled ??= read(hasher).catch((error: unknown) => {
    bundled = undefined;
    throw error;
  });
  return bundled;
}

/** Every shape definition id the records use. */
export function usedDefIds(records: Readonly<Record<string, { readonly type?: unknown; readonly kind?: unknown; readonly defId?: unknown }>>): string[] {
  return Object.values(records).flatMap((r) => (r.type === 'element' && r.kind === 'shape' && typeof r.defId === 'string' ? [r.defId] : []));
}

/** Nothing to load: every entry {@link withPackEntries} adds is registered already. */
const noneToLoad = async (): Promise<boolean> => false;

/**
 * `catalog` with the entries of the packs this document registered itself (M18.212): the imported libraries' `sources` and the
 * subsets the opened file `saved`, so the library heads them by their pack and category names (a saved subset has no pack name,
 * so its id heads it). The catalog itself when there are none.
 */
export function withPackEntries(
  catalog: LibraryCatalog | undefined,
  sources: readonly ShapePackSourceData[],
  saved: readonly VersionedShapePackSubset[],
): LibraryCatalog | undefined {
  const entries = [
    // kind-switch-allow: a source is a distribution or a saved subset, a closed union
    ...sources.flatMap((s) => (s.kind === 'distribution' ? entriesOfIndex(s.index) : entriesOfSubset(s.subset))),
    ...saved.flatMap((s) => entriesOfSubset(s)),
  ];
  if (entries.length === 0) return catalog;
  return { entries: [...(catalog?.entries ?? []), ...entries], ensure: catalog?.ensure ?? noneToLoad };
}
