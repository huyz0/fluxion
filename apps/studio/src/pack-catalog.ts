// The first-party shape packs in the studio's library (FR-LIB-007, FR-LIB-009, M18.32): every pack's index is read and
// verified up front, so the library lists and searches all of them by the names their indexes give; a definition's
// category is fetched, hash-checked and registered only when it is picked, dropped or already used by the open document.
// What a document loaded is what its save embeds (`sources`). A namespace the opened file brought its own saved geometry
// for is left to that geometry: installed and saved versions never mix (ADR-0183).
import { allowsShapePackContentLicense, type Hasher, type Registry, type ShapeDef } from '@fluxion/core';
import { entriesOfIndex, type LibraryCatalog, type LibraryEntry } from '@fluxion/editor';
import type { ShapePackSourceData } from '@fluxion/format';
import { createShapePackLoader, type ShapePackLoader } from '@fluxion/sdk';

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

/** The most one index or category file may hold. */
const MAX_PACK_FILE_BYTES = 4 * 1024 * 1024;

const encoder = new TextEncoder();

/** The loader of the pack whose index is at `path`, reading its files from `categories`, or why it was refused. */
async function loaderOf(path: string, read: () => Promise<string>, categories: Files, hasher: Hasher): Promise<ShapePackLoader | string> {
  const root = path.slice(0, -'index.json'.length);
  const loaded = await createShapePackLoader(encoder.encode(await read()), {
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
 * The first-party packs' verified indexes, one loader each, and the indexes refused (a studio bug).
 *
 * @public
 */
export type PackCatalog = {
  readonly loaders: readonly ShapePackLoader[];
  readonly refused: readonly string[];
};

/** Read and verify every first-party pack index (`indexes` and `categories` default to the bundled ones). */
export async function loadPackCatalog(hasher: Hasher, indexes: Files = INDEXES, categories: Files = CATEGORIES): Promise<PackCatalog> {
  const loaded = await Promise.all(Object.entries(indexes).map(([path, read]) => loaderOf(path, read, categories, hasher)));
  return {
    loaders: loaded.filter((l): l is ShapePackLoader => typeof l !== 'string'),
    refused: loaded.filter((l): l is string => typeof l === 'string'),
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

/** The bundled catalog, read once per page on first use. */
let bundled: Promise<PackCatalog> | undefined;

/** The bundled first-party packs' catalog, verified with `hasher` the first time. */
export function bundledPackCatalog(hasher: Hasher): Promise<PackCatalog> {
  bundled ??= loadPackCatalog(hasher);
  return bundled;
}

/** Every shape definition id the records use. */
export function usedDefIds(records: Readonly<Record<string, { readonly type?: unknown; readonly kind?: unknown; readonly defId?: unknown }>>): string[] {
  return Object.values(records).flatMap((r) => (r.type === 'element' && r.kind === 'shape' && typeof r.defId === 'string' ? [r.defId] : []));
}
