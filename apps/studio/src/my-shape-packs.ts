// My shapes and the open document's packs in Studio (FR-LIB-008, FR-LIB-009, M18.122): a saved item carries the subsets of the
// pack shapes it uses, taken from what a save of this document would embed (its saved packs, imported libraries, loaded
// first-party definitions); inserting one registers the namespaces this document lacks (or adds the shapes an earlier insert's
// namespace lacks), and their sources join the next save.
// Disposing releases what was registered and forgets the sources.
import { type MyShapePack, type MyShapesPacks, myShapePackSet, packsFor } from '@fluxion/editor';
import type { ShapePackSourceData } from '@fluxion/format';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { OpenDocument } from './bootstrap.js';
import { webHasher } from './file-session.js';
import { builtinShapeIds, embeddedSources } from './file-shapes.js';
import type { OpenedEntry } from './opened-files.js';

/**
 * The packs port of one open document, and the sources its inserts added.
 *
 * @public
 */
export type StudioMyShapePacks = {
  /** The editor's port (`EditorRoot.myShapePacks`). */
  readonly packs: MyShapesPacks;
  /** The sources of the packs inserts registered, for the save; a new array after each change. */
  readonly sources: () => readonly ShapePackSourceData[];
  /** Calls `listener` after each change to {@link StudioMyShapePacks.sources}; returns its removal. */
  readonly subscribe: (listener: () => void) => () => void;
  /** Releases every pack inserts registered and forgets its source. */
  readonly dispose: () => void;
};

/** Load the first-party definitions of `defIds` the document has not loaded yet; resolves to the ids that failed. */
export type ResolveShapes = (defIds: readonly string[]) => Promise<readonly string[]>;

/**
 * The port over `opened`, where `saved()` is what a save of the document embeds from now (inserted packs left out), and
 * `resolve` loads first-party definitions: an item's shapes of an installed pack are loaded from it first, so the item uses
 * them as they are and never claims the namespace the library loads from (M18.122 r2 F1).
 *
 * @public
 */
export function studioMyShapePacks(
  opened: Pick<OpenDocument, 'core' | 'artworkFonts'>,
  saved: () => readonly ShapePackSourceData[],
  resolve: ResolveShapes = async () => [],
): StudioMyShapePacks {
  let disposed = false;
  const listeners = new Set<() => void>();
  const set = myShapePackSet({ shapeDefs: opened.core.registries.shapeDefs, artworkFonts: opened.artworkFonts }, { sha256: webHasher.sha256 });
  const closed = { ok: false as const, reason: 'the document closed' };
  const forInsert = async (packs: readonly MyShapePack[]) => {
    if (disposed) return closed;
    await resolve(packs.flatMap((p) => p.subset.definitions.map((d) => d.id)));
    if (disposed) return closed;
    const before = set.sources();
    const added = await set.add(packs);
    // the document closed while the packs registered: the set released them, and the insert is refused
    if (disposed) return closed;
    if (set.sources() !== before) for (const listener of listeners) listener();
    return added;
  };
  return {
    packs: {
      forSave: (records) => packsFor(records, { sources: () => [...saved(), ...set.sources()], builtinIds: builtinShapeIds, hasher: webHasher }),
      forInsert,
    },
    sources: set.sources,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () => {
      disposed = true;
      set.dispose();
    },
  };
}

/**
 * The port of the document `opened` (from `entry`, if a file), made when it opens and released when it closes, and what a
 * save embeds from: `others()` (imported libraries, loaded first-party definitions) and then the sources its inserts added,
 * kept current; `catalog` loads an item's first-party shapes. Made in an effect, so a development double mount gets a
 * fresh port rather than a released one (M18.122 r2 F2).
 */
export function useMyShapePacks(
  opened: Pick<OpenDocument, 'core' | 'artworkFonts'>,
  entry: OpenedEntry | undefined,
  others: () => readonly ShapePackSourceData[],
  catalog?: { readonly resolve: (defIds: Iterable<string>) => Promise<readonly string[]> } | undefined,
): { readonly packs: MyShapesPacks; readonly saveSources: () => readonly ShapePackSourceData[] } {
  const file = entry?.file;
  // others and catalog are read when needed, so the latest is used without making a new port
  const now = useRef({ others, catalog });
  now.current = { others, catalog };
  const port = useRef<StudioMyShapePacks | undefined>(undefined);
  const [sources, setSources] = useState<readonly ShapePackSourceData[]>([]);
  useEffect(() => {
    const embedded = () => [...embeddedSources(file?.shapePacks ?? [], file?.artworkFonts), ...now.current.others()];
    const mine = studioMyShapePacks(opened, embedded, (ids) => now.current.catalog?.resolve(ids) ?? Promise.resolve([]));
    port.current = mine;
    const off = mine.subscribe(() => setSources(mine.sources()));
    return () => {
      off();
      mine.dispose();
      if (port.current === mine) port.current = undefined;
      setSources([]);
    };
  }, [opened, file]);
  const packs = useMemo<MyShapesPacks>(() => {
    const closed = Promise.resolve({ ok: false as const, reason: 'the document closed' });
    return { forSave: (records) => port.current?.packs.forSave(records) ?? closed, forInsert: (p) => port.current?.packs.forInsert(p) ?? closed };
  }, []);
  return { packs, saveSources: () => [...others(), ...sources] };
}
