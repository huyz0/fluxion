// My shapes (FR-LIB-008, M18.34; ADR-0048 amendment M18.34): a selection saved as a reusable item of the person's
// local pack. An item holds the selection as a clipboard payload (ADR-0020): its elements with their members, styles
// and text, the bindings between them and the image bytes they use, so inserting one is a paste into any document.
// Items are kept in local storage and travel as a `fluxion-my-shapes` file, which is untrusted on import: every item
// is validated like a pasted clipboard before anything of it is used.
import { type ReadSignal, type ReadView, writable } from '@fluxion/core';
import type { Vec2 } from '@fluxion/geometry';
import type { RecordId } from '@fluxion/schema';
import { type ClipboardPayload, copyPayload, type PasteDeps, pasteInto } from '../clipboard.js';
import { MAX_PAYLOAD_CHARS, parsePayload } from '../clipboard-format.js';

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
};

/**
 * What reading something untrusted gave: `value`, or why it was refused.
 *
 * @public
 */
export type MyShapesResult<T> =
  | {
      /** It was read. */
      readonly ok: true;
      /** What was read. */
      readonly value: T;
    }
  | {
      /** It was refused. */
      readonly ok: false;
      /** Why, for the person. */
      readonly reason: string;
    };

/**
 * The `fluxion-my-shapes` file: exported items, imported elsewhere.
 *
 * @public
 */
export type MyShapesFile = {
  /** Discriminator. */
  readonly format: 'fluxion-my-shapes';
  /** File format version. */
  readonly formatVersion: '1.0';
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
 * Save the elements `ids` of `view` (members and the bindings between them included) as item `id` named `name`;
 * undefined when none is an element or `id` is not 1 to 64 letters, digits, `_` or `-`.
 *
 * @public
 */
export function saveMyShape(
  view: ReadView,
  ids: readonly RecordId[],
  item: { readonly id: string; readonly name: string },
  source: Parameters<typeof copyPayload>[2],
): MyShape | undefined {
  const payload = copyPayload(view, ids, source);
  const name = item.name.trim().slice(0, MAX_NAME);
  if (payload?.bounds === undefined || name === '' || !validId(item.id)) return undefined;
  return { id: item.id, name, payload: { ...payload, bounds: payload.bounds } };
}

/**
 * Insert `item` centred on `centre` (page units) as one undo step, through the paste path; the ids of the inserted
 * roots, or undefined when nothing was inserted.
 *
 * @public
 */
export function insertMyShape(deps: PasteDeps, item: MyShape, centre: Vec2): readonly RecordId[] | undefined {
  const { x, y, w, h } = item.payload.bounds;
  return pasteInto(deps, item.payload, { x: centre.x - (x + w / 2), y: centre.y - (y + h / 2) });
}

/**
 * The text of a `fluxion-my-shapes` file of `items`.
 *
 * @public
 */
export function exportMyShapes(items: readonly MyShape[]): string {
  const file: MyShapesFile = { format: 'fluxion-my-shapes', formatVersion: '1.0', items };
  return JSON.stringify(file);
}

const isObject = (v: unknown): v is { readonly [key: string]: unknown } => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** `raw` as a validated item, or why it is not one. */
function itemOf(raw: unknown, k: number): MyShape | string {
  if (!isObject(raw)) return `item ${k} is not an object`;
  const { id, name, payload } = raw;
  if (typeof id !== 'string' || !validId(id)) return `item ${k} has no valid id`;
  if (typeof name !== 'string' || name.trim() === '' || name.length > MAX_NAME) return `item ${k} has no valid name`;
  const parsed = parsePayload(JSON.stringify(payload ?? null));
  if (!parsed.ok) return `item ${k}: ${parsed.reason}`;
  const b = parsed.payload.bounds as { readonly [key: string]: unknown } | undefined;
  if (b === undefined || !finite(b['x']) || !finite(b['y']) || !finite(b['w']) || !finite(b['h']) || b['w'] < 0 || b['h'] < 0)
    return `item ${k} has no valid bounds`;
  const bounds = { x: b['x'], y: b['y'], w: b['w'], h: b['h'] };
  return { id, name: name.trim(), payload: { ...parsed.payload, bounds } };
}

/**
 * The items of a `fluxion-my-shapes` file (untrusted text): every item validated like a pasted clipboard, ids unique,
 * names present, bounds finite; a file with any bad item is refused whole, with the reason.
 *
 * @public
 */
export function parseMyShapes(raw: string): MyShapesResult<readonly MyShape[]> {
  return readFile(raw, 1);
}

/** `parseMyShapes`, with at least `least` items (what is stored may hold none). */
function readFile(raw: string, least: number): MyShapesResult<readonly MyShape[]> {
  if (raw.length > MAX_PAYLOAD_CHARS) return { ok: false, reason: 'the file is too large' };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'not JSON' };
  }
  if (!isObject(json) || json['format'] !== 'fluxion-my-shapes') return { ok: false, reason: 'not a My shapes file' };
  if (json['formatVersion'] !== '1.0') return { ok: false, reason: `version ${String(json['formatVersion'])} cannot be read` };
  const raws = json['items'];
  if (!Array.isArray(raws) || raws.length < least || raws.length > MAX_MY_SHAPES) return { ok: false, reason: 'no items, or too many' };
  const items: MyShape[] = [];
  for (const [k, r] of raws.entries()) {
    const item = itemOf(r, k);
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
  /** The items, oldest first. */
  readonly items: ReadSignal<readonly MyShape[]>;
  /** Add `item`, or replace the item with its id; false when it would not read back (id, name, payload), storage refuses it (full) or there are too many. */
  put(item: MyShape): boolean;
  /** Remove the item `id`. */
  remove(id: string): boolean;
  /** Add the items of a file; an item whose id is held already replaces it. How many were added, or why the file is refused. */
  importFile(raw: string): MyShapesResult<number>;
};

/**
 * The storage key of My shapes.
 *
 * @public
 */
export const MY_SHAPES_KEY = 'fluxion.my-shapes';

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
 * reads back as empty.
 *
 * @public
 */
export function createMyShapes(storage: MyShapesStorage): MyShapes {
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
    items: items.get,
    put: (item) => typeof itemOf(item, 0) !== 'string' && change((now) => merged(now, [item])),
    remove: (id) => change((now) => (now.some((i) => i.id === id) ? now.filter((i) => i.id !== id) : undefined)),
    importFile: (raw) => {
      const file = parseMyShapes(raw);
      if (!file.ok) return file;
      return change((now) => merged(now, file.value)) ? { ok: true, value: file.value.length } : { ok: false, reason: 'there is no room for the items' };
    },
  };
}
