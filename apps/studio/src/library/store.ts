// The local library (FR-FIL-008): the documents the person saved in this browser, newest first, each with its `.flux` and a small preview. A port
// with a memory adapter for tests and an IndexedDB adapter (database `fluxion-library`, one `entries` store) for the studio. Only the newest
// `LIBRARY_LIMIT` entries are kept: the library is a convenience for reopening, not a place the only copy of anything lives.

/**
 * How many entries the library keeps.
 *
 * @public
 */
export const LIBRARY_LIMIT = 50;

/**
 * One document in the library.
 *
 * @public
 */
export type LibraryEntry = {
  /** What names it: saving under the same id replaces the entry. */
  readonly id: string;
  /** The name to show (the file name). */
  readonly name: string;
  /** When it was saved, ISO 8601. */
  readonly saved: string;
  /** The whole `.flux`. */
  readonly bytes: Uint8Array;
  /** The preview image (`preview.webp`), when one could be made. */
  readonly thumb?: Uint8Array;
};

/**
 * The library's storage.
 *
 * @public
 */
export interface LibraryStore {
  /** Add `entry`, or replace the entry with its id, then drop all but the newest `LIBRARY_LIMIT`. */
  put(entry: LibraryEntry): Promise<void>;
  /** The entries, newest first, at most `limit` of them. */
  recent(limit: number): Promise<readonly LibraryEntry[]>;
  /** One entry, or undefined. */
  get(id: string): Promise<LibraryEntry | undefined>;
  /** Remove an entry; removing what is not there is not an error. */
  remove(id: string): Promise<void>;
  /** Let go of the storage. */
  close(): void;
}

/** Newest first; entries saved in the same millisecond are ordered by id so that the order is the same everywhere. */
const newestFirst = (a: LibraryEntry, b: LibraryEntry): number => (a.saved < b.saved ? 1 : a.saved > b.saved ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/** The ids to drop after `entry` was written: the oldest of the others beyond the limit; the entry just written is never one of them. */
const excessIds = (all: readonly LibraryEntry[], entry: LibraryEntry): string[] =>
  all
    .filter((e) => e.id !== entry.id)
    .sort(newestFirst)
    .slice(LIBRARY_LIMIT - 1)
    .map((e) => e.id);

/**
 * A library in memory.
 *
 * @public
 */
export function memoryLibrary(): LibraryStore {
  const entries = new Map<string, LibraryEntry>();
  return {
    put(entry) {
      entries.set(entry.id, entry);
      for (const id of excessIds([...entries.values()], entry)) entries.delete(id);
      return Promise.resolve();
    },
    recent: (limit) => Promise.resolve([...entries.values()].sort(newestFirst).slice(0, limit)),
    get: (id) => Promise.resolve(entries.get(id)),
    remove(id) {
      entries.delete(id);
      return Promise.resolve();
    },
    close: () => undefined,
  };
}

/**
 * The name of the library's database.
 *
 * @public
 */
export const LIBRARY_DB = 'fluxion-library';

const request = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

const settled = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new DOMException('the transaction was aborted', 'AbortError'));
  });

function openDb(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = factory.open(name, 1);
    open.onupgradeneeded = () => {
      const store = open.result.createObjectStore('entries', { keyPath: 'id' });
      store.createIndex('saved', 'saved');
    };
    open.onsuccess = () => {
      const db = open.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new DOMException('the library is open in a tab that has not let go of an older version', 'InvalidStateError'));
  });
}

/**
 * The library on IndexedDB; rejects where the browser refuses it.
 *
 * @public
 */
export async function idbLibrary(factory: IDBFactory = indexedDB, name: string = LIBRARY_DB): Promise<LibraryStore> {
  const db = await openDb(factory, name);
  return {
    async put(entry) {
      const tx = db.transaction('entries', 'readwrite');
      const store = tx.objectStore('entries');
      const done = settled(tx);
      // if the work below fails the transaction aborts and `done` rejects with nobody waiting: it is handled here, and the failure is the work's own
      done.catch(() => undefined);
      store.put(entry);
      // everything beyond the limit goes in the same transaction
      const all = (await request(store.getAll())) as LibraryEntry[];
      for (const id of excessIds(all, entry)) store.delete(id);
      await done;
    },
    async recent(limit) {
      const tx = db.transaction('entries', 'readonly');
      const all = (await request(tx.objectStore('entries').getAll())) as LibraryEntry[];
      return all.sort(newestFirst).slice(0, limit);
    },
    async get(id) {
      const tx = db.transaction('entries', 'readonly');
      return (await request(tx.objectStore('entries').get(id))) as LibraryEntry | undefined;
    },
    async remove(id) {
      const tx = db.transaction('entries', 'readwrite');
      const done = settled(tx);
      tx.objectStore('entries').delete(id);
      await done;
    },
    close: () => db.close(),
  };
}
