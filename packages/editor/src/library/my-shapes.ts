// My shapes (FR-LIB-008, M18.34; ADR-0048 amendment M18.34): a selection saved as a reusable item of the person's
// local pack. An item holds the selection as a clipboard payload (ADR-0020): its elements with their members, styles
// and text, the bindings between them and the image bytes they use, so inserting one is a paste into any document.
// Items are kept in local storage and travel as a `fluxion-my-shapes` file, which is untrusted on import: every item
// is validated like a pasted clipboard before anything of it is used. An item that uses pack shapes carries their subsets
// (M18.122, `my-shapes-packs.ts`), and a file holding one is version 1.1.
import { type ReadSignal, type ReadView, writable } from '@fluxion/core';
import type { Vec2 } from '@fluxion/geometry';
import type { RecordId } from '@fluxion/schema';
import { type ClipboardPayload, copyPayload, type PasteDeps, pasteInto } from '../clipboard.js';
import { MAX_PAYLOAD_CHARS, parsePayload } from '../clipboard-format.js';
import { type MyShapePack, type MyShapesResult, packShapeIds, parseMyShapePacks } from './my-shapes-packs.js';

export type { MyShapesResult } from './my-shapes-packs.js';

/**
 * One saved item of My shapes.
 *
 * @public
 */
export type MyShape = {
  /** Unique within the person's My shapes. */
  readonly id: string;
  /** The name shown in the library. */
  readonly name: string;
  /** The saved selection, with bounds. */
  readonly payload: ClipboardPayload & {
    /** The selection's bounds, page units: an insert centres them. */
    readonly bounds: NonNullable<ClipboardPayload['bounds']>;
  };
  /** The pack subsets of the shapes it uses that are not built in (M18.122); none when it uses only built-in shapes. */
  readonly packs?: readonly MyShapePack[];
};

/**
 * The `fluxion-my-shapes` file: exported items, imported elsewhere.
 *
 * @public
 */
export type MyShapesFile = {
  /** Discriminator. */
  readonly format: 'fluxion-my-shapes';
  /** File format version: 1.1 when an item carries packs. */
  readonly formatVersion: '1.0' | '1.1';
  /** The items. */
  readonly items: readonly MyShape[];
};

/**
 * The most items one file or one person's My shapes holds.
 *
 * @public
 */
export const MAX_MY_SHAPES = 500;
/** Whether `id` can name an item: what a file is read with, so every saved item reads back. */
const validId = (id: string): boolean => /^[\w-]{1,64}$/.test(id);

/** The most characters a name has. */
const MAX_NAME = 120;

/**
 * Whether a shape definition is in every session, so an item that uses it inserts and renders anywhere: the built-in
 * shapes. My shapes items carry no definitions, so a host passes this and an item using any other is refused.
 *
 * @public
 */
export type ShapeAvailable = (defId: string) => boolean;

/** The definitions of the shapes in `payload` that neither `available` nor `packs` has, sorted, each once. */
function unavailableShapes(payload: ClipboardPayload, available: ShapeAvailable, packs?: readonly MyShapePack[]): readonly string[] {
  const carried = packShapeIds(packs);
  const ids = new Set<string>();
  for (const r of payload.records) {
    const defId = (r as { readonly kind?: unknown; readonly defId?: unknown }).defId;
    if ((r as { readonly kind?: unknown }).kind === 'shape' && typeof defId === 'string' && !available(defId) && !carried.has(defId)) ids.add(defId);
  }
  return [...ids].sort();
}

/** Why `payload` cannot be kept with `packs`, when it uses shapes that are neither available everywhere nor carried. */
const unavailableReason = (payload: ClipboardPayload, available: ShapeAvailable, packs?: readonly MyShapePack[]): string | undefined => {
  const missing = unavailableShapes(payload, available, packs);
  return missing.length === 0 ? undefined : `it uses shapes that are not built in: ${missing.join(', ')}`;
};

/**
 * A document's packs for My shapes (M18.122): the subsets a saved item carries, and how an inserted item's subsets join the
 * document (registered where absent, and embedded by its next save).
 *
 * @public
 */
export type MyShapesPacks = {
  /** The subsets the shapes of `records` need beyond the built-in ones, or why there are none to carry. */
  readonly forSave: (records: ClipboardPayload['records']) => Promise<MyShapesResult<readonly MyShapePack[]>>;
  /** Make `packs` usable in the document; why not, with nothing registered. */
  readonly forInsert: (packs: readonly MyShapePack[]) => Promise<MyShapesResult<undefined>>;
  /**
   * Why `packs` could not be used here, checked before any insert and without registering or loading anything into the document
   * (an installed pack whose geometry changed since the item was saved, M18.271), or undefined; absent, nothing is checked ahead.
   */
  readonly check?: ((packs: readonly MyShapePack[]) => Promise<string | undefined>) | undefined;
};

/**
 * Save the elements `ids` of `view` (members and the bindings between them included) as item `id` named `name`; refused,
 * with the reason, when none is an element, the name is blank, `id` is not 1 to 64 letters, digits, `_` or `-`, or a
 * shape's definition is neither `host.available` nor carried by the subsets `host.packs` gives (it would not insert in
 * another session); `host.source` is the copy's source.
 *
 * @public
 */
export async function saveMyShape(
  view: ReadView,
  ids: readonly RecordId[],
  item: { readonly id: string; readonly name: string },
  host: { readonly source: Parameters<typeof copyPayload>[2]; readonly available: ShapeAvailable; readonly packs?: MyShapesPacks | undefined },
): Promise<MyShapesResult<MyShape>> {
  const payload = copyPayload(view, ids, host.source);
  const name = item.name.trim().slice(0, MAX_NAME);
  if (payload?.bounds === undefined) return { ok: false, reason: 'nothing selected can be saved' };
  if (name === '') return { ok: false, reason: 'the name is blank' };
  if (!validId(item.id)) return { ok: false, reason: `the id ${item.id} is not valid` };
  const saved = { id: item.id, name, payload: { ...payload, bounds: payload.bounds } };
  if (unavailableReason(payload, host.available) === undefined) return { ok: true, value: saved };
  const packs = host.packs === undefined ? undefined : await host.packs.forSave(payload.records);
  if (packs?.ok === false) return packs;
  const unavailable = unavailableReason(payload, host.available, packs?.value);
  if (unavailable !== undefined) return { ok: false, reason: unavailable };
  return { ok: true, value: { ...saved, packs: packs?.value ?? [] } };
}

/**
 * Why `item` cannot be inserted where only `available` shapes exist and its packs carry the rest, or undefined when it can:
 * what a host re-checks a stored item with on read (an item kept from before, or by another host on the same storage), and
 * what the section lists it with, to list it as unavailable rather than insert unknown shapes (cp32 F4); a shape its packs
 * carry counts, as inserting registers them (M18.122 r1 F1).
 *
 * @public
 */
export const myShapeUnavailable = (item: MyShape, available: ShapeAvailable): string | undefined => unavailableReason(item.payload, available, item.packs);

/**
 * Insert `item` centred on `centre` (page units) as one undo step, through the paste path: the ids of the inserted
 * roots, or why nothing was inserted (it uses shapes that are neither `available` here nor carried by its packs, as an
 * item kept from before may). An item's packs must be registered first ({@link MyShapesPacks.forInsert}).
 *
 * @public
 */
export function insertMyShape(deps: PasteDeps, item: MyShape, centre: Vec2, available: ShapeAvailable): MyShapesResult<readonly RecordId[]> {
  const unavailable = unavailableReason(item.payload, available, item.packs);
  if (unavailable !== undefined) return { ok: false, reason: unavailable };
  const { x, y, w, h } = item.payload.bounds;
  const roots = pasteInto(deps, item.payload, { x: centre.x - (x + w / 2), y: centre.y - (y + h / 2) });
  return roots === undefined ? { ok: false, reason: 'nothing could be inserted' } : { ok: true, value: roots };
}

/**
 * The text of a `fluxion-my-shapes` file of `items`.
 *
 * @public
 */
export function exportMyShapes(items: readonly MyShape[]): string {
  const formatVersion = items.some((i) => (i.packs?.length ?? 0) > 0) ? '1.1' : '1.0';
  const file: MyShapesFile = { format: 'fluxion-my-shapes', formatVersion, items };
  return JSON.stringify(file);
}

const isObject = (v: unknown): v is { readonly [key: string]: unknown } => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The packs of item `k` of a file of `version`: none in 1.0, validated in 1.1. */
function packsOf(raw: unknown, k: number, version: string): readonly MyShapePack[] | string {
  if (raw === undefined) return [];
  if (version !== '1.1') return `item ${k} carries packs, which version ${version} has not`;
  const packs = parseMyShapePacks(raw);
  return typeof packs === 'string' ? `item ${k}: ${packs}` : packs;
}

/** `raw` as finite, non-negative bounds, or undefined. */
function boundsOf(raw: unknown): MyShape['payload']['bounds'] | undefined {
  const b = raw as { readonly [key: string]: unknown } | undefined;
  if (b === undefined || !finite(b['x']) || !finite(b['y']) || !finite(b['w']) || !finite(b['h']) || b['w'] < 0 || b['h'] < 0) return undefined;
  return { x: b['x'], y: b['y'], w: b['w'], h: b['h'] };
}

/** `raw` as a validated item of a file of `version`, or why it is not one. */
function itemOf(raw: unknown, k: number, read: { readonly available?: ShapeAvailable | undefined; readonly version: string }): MyShape | string {
  if (!isObject(raw)) return `item ${k} is not an object`;
  const { id, name, payload } = raw;
  if (typeof id !== 'string' || !validId(id)) return `item ${k} has no valid id`;
  if (typeof name !== 'string' || name.trim() === '' || name.length > MAX_NAME) return `item ${k} has no valid name`;
  const parsed = parsePayload(JSON.stringify(payload ?? null));
  if (!parsed.ok) return `item ${k}: ${parsed.reason}`;
  const bounds = boundsOf(parsed.payload.bounds);
  if (bounds === undefined) return `item ${k} has no valid bounds`;
  const packs = packsOf(raw['packs'], k, read.version);
  if (typeof packs === 'string') return packs;
  const unavailable = read.available === undefined ? undefined : unavailableReason(parsed.payload, read.available, packs);
  if (unavailable !== undefined) return `item ${k}: ${unavailable}`;
  const item = { id, name: name.trim(), payload: { ...parsed.payload, bounds } };
  return packs.length === 0 ? item : { ...item, packs };
}

/**
 * The items of a `fluxion-my-shapes` file (untrusted text): every item validated like a pasted clipboard, ids unique,
 * names present, bounds finite and, given `available`, every shape's definition available; a file with any bad item is
 * refused whole, with the reason.
 *
 * @public
 */
export function parseMyShapes(raw: string, available?: ShapeAvailable): MyShapesResult<readonly MyShape[]> {
  return readFile(raw, 1, available);
}

/** The JSON of a My shapes file `raw`, with its version, or why it is not one. */
function fileOf(raw: string): MyShapesResult<{ readonly json: { readonly [key: string]: unknown }; readonly version: string }> {
  if (raw.length > MAX_PAYLOAD_CHARS) return { ok: false, reason: 'the file is too large' };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'not JSON' };
  }
  if (!isObject(json) || json['format'] !== 'fluxion-my-shapes') return { ok: false, reason: 'not a My shapes file' };
  const version = json['formatVersion'];
  if (version !== '1.0' && version !== '1.1') return { ok: false, reason: `version ${String(version)} cannot be read` };
  return { ok: true, value: { json, version } };
}

/** `parseMyShapes`, with at least `least` items (what is stored may hold none). */
function readFile(raw: string, least: number, available?: ShapeAvailable): MyShapesResult<readonly MyShape[]> {
  const file = fileOf(raw);
  if (!file.ok) return file;
  const { json, version } = file.value;
  const raws = json['items'];
  if (!Array.isArray(raws) || raws.length < least || raws.length > MAX_MY_SHAPES) return { ok: false, reason: 'no items, or too many' };
  const items: MyShape[] = [];
  for (const [k, r] of raws.entries()) {
    const item = itemOf(r, k, { available, version });
    if (typeof item === 'string') return { ok: false, reason: item };
    if (items.some((i) => i.id === item.id)) return { ok: false, reason: `item ${k} repeats id ${item.id}` };
    items.push(item);
  }
  return { ok: true, value: items };
}

/**
 * Where items are kept: a key-value store such as `localStorage` (a host passes it; tests pass a map).
 *
 * @public
 */
export type MyShapesStorage = {
  /** The text under `key`, or null. */
  getItem(key: string): string | null;
  /** Keep `value` under `key`; may throw when storage is full. */
  setItem(key: string, value: string): void;
};

/**
 * The person's My shapes: the items, kept in storage, with saving, removing and merging an imported file.
 *
 * @public
 */
export type MyShapes = {
  /** The shapes an item may use here (the host's). */
  readonly available: ShapeAvailable;
  /** The items, oldest first. */
  readonly items: ReadSignal<readonly MyShape[]>;
  /** Add `item`, or replace the item with its id; false when it would not read back (id, name, payload), storage refuses it (full) or there are too many. */
  put(item: MyShape): boolean;
  /** Remove the item `id`. */
  remove(id: string): boolean;
  /** Add the items of a file; an item whose id is held already is added under a new id, never replacing it. How many were added, or why the file is refused. */
  importFile(raw: string): MyShapesResult<number>;
};

/**
 * The storage key of My shapes.
 *
 * @public
 */
export const MY_SHAPES_KEY = 'fluxion.my-shapes';

/**
 * `adds` with each id that `now` (or an earlier add) holds already given the next free `<id>-<n>`: an import never
 * replaces an item the person has.
 */
function renamed(now: readonly MyShape[], adds: readonly MyShape[]): readonly MyShape[] {
  const taken = new Set(now.map((i) => i.id));
  return adds.map((item) => {
    let id = item.id;
    for (let n = 2; taken.has(id); n++) id = `${item.id.slice(0, 64 - String(n).length - 1)}-${n}`;
    taken.add(id);
    return id === item.id ? item : { ...item, id };
  });
}

/**
 * Where an unreadable stored value is kept before My shapes is written again (a newer version's file, say), so it is
 * never overwritten.
 *
 * @public
 */
export const MY_SHAPES_UNREADABLE_KEY = 'fluxion.my-shapes.unreadable';

/**
 * My shapes kept in `storage` under {@link MY_SHAPES_KEY}. Every change starts from what is stored now, so items another
 * tab saved are kept. A stored value that does not validate is never used and never destroyed: it is moved to
 * {@link MY_SHAPES_UNREADABLE_KEY} before the next change (opening writes nothing), and while it cannot be moved (that key
 * holds another value, or storage refuses) nothing is written. An emptied My shapes stores a file of no items, which
 * reads back as empty. An item put or imported must use only `available` shapes.
 *
 * @public
 */
export function createMyShapes(storage: MyShapesStorage, available: ShapeAvailable): MyShapes {
  const read = (key: string): string | null => {
    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  };
  /** `raw` kept aside under the unreadable key; false when it cannot be. */
  const setAside = (raw: string): boolean => {
    const kept = read(MY_SHAPES_UNREADABLE_KEY);
    if (kept === raw) return true;
    if (kept !== null) return false;
    try {
      storage.setItem(MY_SHAPES_UNREADABLE_KEY, raw);
      return read(MY_SHAPES_UNREADABLE_KEY) === raw;
    } catch {
      return false;
    }
  };
  /** The stored items now (none when the stored value is unreadable); `aside` before a write: undefined when that value cannot be set aside. */
  const stored = (aside: boolean): readonly MyShape[] | undefined => {
    const raw = read(MY_SHAPES_KEY);
    if (raw === null) return [];
    const parsed = readFile(raw, 0);
    if (parsed.ok) return parsed.value;
    return !aside || setAside(raw) ? [] : undefined;
  };
  // opening writes nothing: an unreadable value is set aside only before the first change
  const items = writable<readonly MyShape[]>(stored(false) ?? []);
  /** Write `change` of the stored items; false when nothing was written. */
  const change = (edit: (now: readonly MyShape[]) => readonly MyShape[] | undefined): boolean => {
    const now = stored(true);
    const next = now === undefined ? undefined : edit(now);
    if (next === undefined || next.length > MAX_MY_SHAPES) return false;
    const text = exportMyShapes(next);
    // what is written must read back
    if (text.length > MAX_PAYLOAD_CHARS) return false;
    try {
      storage.setItem(MY_SHAPES_KEY, text);
    } catch {
      return false;
    }
    items.set(next);
    return true;
  };
  const merged = (now: readonly MyShape[], adds: readonly MyShape[]) => {
    const ids = new Set(adds.map((i) => i.id));
    return [...now.filter((i) => !ids.has(i.id)), ...adds];
  };
  return {
    available,
    items: items.get,
    put: (item) => typeof itemOf(item, 0, { available, version: '1.1' }) !== 'string' && change((now) => merged(now, [item])),
    remove: (id) => change((now) => (now.some((i) => i.id === id) ? now.filter((i) => i.id !== id) : undefined)),
    importFile: (raw) => {
      const file = parseMyShapes(raw, available);
      if (!file.ok) return file;
      return change((now) => [...now, ...renamed(now, file.value)])
        ? { ok: true, value: file.value.length }
        : { ok: false, reason: 'there is no room for the items' };
    },
  };
}
