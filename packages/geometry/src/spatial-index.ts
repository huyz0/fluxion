// Spatial index (ADR-0141): rbush (dynamic, editor) and flatbush (static, player/export) behind one
// interface. Neither library orders its results, so every query sorts hits by id (NFR-REL-005):
// the two adapters answer the same queries identically, whatever their tree shapes.
import Flatbush from 'flatbush';
import RBush from 'rbush';
import type { Box } from './box.js';

/**
 * An item of a spatial index: an id and its axis-aligned bounds (finite, `w` and `h` ≥ 0).
 *
 * @public
 */
export type IndexedBox = {
  /** Unique id, e.g. an element's record id. */
  readonly id: string;
  /** Bounds of the item. */
  readonly box: Box;
};

/**
 * Box queries over a set of items. Boxes that only touch at an edge or corner intersect.
 *
 * @public
 */
export type SpatialIndex = {
  /** Number of items. */
  readonly size: number;
  /** Ids of the items whose box intersects `box`, sorted by id (code-unit order). */
  search(box: Box): string[];
  /** Whether any item's box intersects `box`. */
  collides(box: Box): boolean;
};

/**
 * A {@link SpatialIndex} that changes as items are added and removed (the editor's index).
 *
 * @public
 */
export type DynamicSpatialIndex = SpatialIndex & {
  /** Add an item; an item with the same id is replaced. */
  insert(item: IndexedBox): void;
  /** Remove the item with this id; false when there is none. */
  remove(id: string): boolean;
  /** Remove every item. */
  clear(): void;
};

type Entry = { readonly id: string; readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number };

const entryOf = ({ id, box }: IndexedBox): Entry => ({ id, minX: box.x, minY: box.y, maxX: box.x + box.w, maxY: box.y + box.h });
const bboxOf = (box: Box): Omit<Entry, 'id'> => ({ minX: box.x, minY: box.y, maxX: box.x + box.w, maxY: box.y + box.h });
const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The last item of each id, so both adapters see the same set whatever the input repeats. */
function uniqueEntries(items: readonly IndexedBox[]): Entry[] {
  const entries = new Map<string, Entry>();
  for (const item of items) entries.set(item.id, entryOf(item));
  return [...entries.values()];
}

/**
 * A dynamic index backed by `rbush`, optionally bulk-loaded with `items` (the last item of a
 * repeated id wins).
 *
 * @public
 */
export function createDynamicIndex(items: readonly IndexedBox[] = []): DynamicSpatialIndex {
  const tree = new RBush<Entry>();
  const byKey = new Map<string, Entry>();
  for (const e of uniqueEntries(items)) byKey.set(e.id, e);
  tree.load([...byKey.values()]);
  const remove = (id: string): boolean => {
    const e = byKey.get(id);
    if (e === undefined) return false;
    tree.remove(e);
    byKey.delete(id);
    return true;
  };
  return {
    get size(): number {
      return byKey.size;
    },
    search: (box: Box): string[] =>
      tree
        .search(bboxOf(box))
        .map((e) => e.id)
        .sort(byId),
    collides: (box: Box): boolean => tree.collides(bboxOf(box)),
    insert: (item: IndexedBox): void => {
      remove(item.id);
      const e = entryOf(item);
      byKey.set(e.id, e);
      tree.insert(e);
    },
    remove,
    clear: (): void => {
      tree.clear();
      byKey.clear();
    },
  };
}

/**
 * A static index backed by `flatbush`, built once from `items` (the last item of a repeated id
 * wins); faster to query and smaller than the dynamic one (the player's index).
 *
 * @public
 */
export function createStaticIndex(items: readonly IndexedBox[]): SpatialIndex {
  const entries = uniqueEntries(items);
  // flatbush needs at least one item
  if (entries.length === 0) return { size: 0, search: (): string[] => [], collides: (): boolean => false };
  const tree = new Flatbush(entries.length);
  for (const e of entries) tree.add(e.minX, e.minY, e.maxX, e.maxY);
  tree.finish();
  const hits = (box: Box): number[] => {
    const b = bboxOf(box);
    return tree.search(b.minX, b.minY, b.maxX, b.maxY);
  };
  return {
    size: entries.length,
    search: (box: Box): string[] =>
      hits(box)
        .map((i) => entries[i]?.id ?? '')
        .sort(byId),
    collides: (box: Box): boolean => hits(box).length > 0,
  };
}
