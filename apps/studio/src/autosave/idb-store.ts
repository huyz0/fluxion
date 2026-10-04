// The IndexedDB autosave store (ADR-0024): database `fluxion-autosave`, version 1, four object stores. `docs` (key docId) holds each document's
// record; `journal` (key [docId, seq]) the entries as text; `checkpoints` (key docId) the full records at a sequence number; `assets` (key hash)
// the bytes of assets where the browser has no OPFS. A schema change is a new version with an upgrade step; nothing is dropped on upgrade.
import { type BlobStore, segments } from './blobs.js';
import type { AutosaveStore, Checkpoint, Commit, DocMeta, StoredEntry, StoredJournal } from './store.js';

/**
 * The name of the database.
 *
 * @public
 */
export const AUTOSAVE_DB = 'fluxion-autosave';

type CheckpointRow = Checkpoint & { readonly docId: string };
type EntryRow = StoredEntry & { readonly docId: string };

/**
 * `request` as a promise of its result. The promise is marked handled up front: when a transaction aborts, every request still waiting in it
 * rejects, and one nobody is awaiting any more must not be reported as an unhandled rejection. Whoever awaits it still gets the rejection.
 */
const result = <T>(request: IDBRequest<T>): Promise<T> => {
  const promise = new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  promise.catch(() => undefined);
  return promise;
};

/** All of `requests`, settled together: when the transaction aborts every one rejects, and none is left without a handler to report an unhandled rejection. */
function together(requests: readonly Promise<unknown>[]): Promise<unknown[]> {
  for (const r of requests) r.catch(() => undefined);
  return Promise.all(requests);
}

/** Run `work` in one transaction over `stores`; resolves when the transaction has committed, rejects when it aborts. */
function inTransaction<T>(db: IDBDatabase, stores: readonly string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([...stores], mode);
    let value: T;
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new DOMException('the transaction was aborted', 'AbortError'));
    work(tx).then(
      (v) => {
        value = v;
      },
      (e: unknown) => {
        tx.abort();
        reject(e);
      },
    );
  });
}

/**
 * Open (and create or upgrade) the database. A connection that arrives after the open was given up on (blocked by another tab) is closed, and an
 * open connection lets go when another tab wants to upgrade, so a new version is never blocked by a tab that is just sitting there.
 */
function open(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, 1);
    let givenUp = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('docs', { keyPath: 'docId' });
      db.createObjectStore('journal', { keyPath: ['docId', 'seq'] });
      db.createObjectStore('checkpoints', { keyPath: 'docId' });
      db.createObjectStore('assets', { keyPath: 'hash' });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      if (givenUp) db.close();
      else resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      givenUp = true;
      reject(new DOMException('the autosave database is open in a tab that has not let go of an older version', 'InvalidStateError'));
    };
  });
}

/** Bytes in the `assets` object store, for a browser with no OPFS: each row is `{ hash: <path>, bytes }`. */
function idbBlobs(db: IDBDatabase): BlobStore {
  return {
    put: (path, bytes) =>
      inTransaction(db, ['assets'], 'readwrite', async (tx) => {
        segments(path);
        await result(tx.objectStore('assets').put({ hash: path, bytes }));
      }),
    get: (path) =>
      inTransaction(db, ['assets'], 'readonly', async (tx) => {
        segments(path);
        const row = (await result(tx.objectStore('assets').get(path))) as { bytes: Uint8Array } | undefined;
        return row?.bytes;
      }),
    list: (dir) =>
      inTransaction(db, ['assets'], 'readonly', async (tx) => {
        segments(dir);
        const keys = (await result(tx.objectStore('assets').getAllKeys(IDBKeyRange.bound(`${dir}/`, `${dir}0`, false, true)))) as string[];
        return [...new Set(keys.map((k) => k.slice(dir.length + 1).split('/')[0] ?? ''))];
      }),
    remove: (path) =>
      inTransaction(db, ['assets'], 'readwrite', async (tx) => {
        segments(path);
        await result(tx.objectStore('assets').delete(path));
      }),
  };
}

/**
 * The autosave store on IndexedDB. `name` is the database name (tests use their own); a browser with no IndexedDB, or a private window that refuses
 * it, rejects here and the caller falls back to a memory store and says so.
 *
 * @public
 */
export async function idbAutosaveStore(
  factory: IDBFactory = indexedDB,
  name: string = AUTOSAVE_DB,
): Promise<AutosaveStore & { readonly blobs: BlobStore; close(): void }> {
  const db = await open(factory, name);
  return {
    blobs: idbBlobs(db),
    close: () => db.close(),
    commit: (docId, commit: Commit) =>
      inTransaction(db, ['docs', 'journal', 'checkpoints'], 'readwrite', async (tx) => {
        const journal = tx.objectStore('journal');
        // a torn tail goes first, in this transaction: the entries after it follow on from the last good one
        const puts: Promise<unknown>[] = [];
        if (commit.truncateAfter !== undefined)
          puts.push(result(journal.delete(IDBKeyRange.bound([docId, commit.truncateAfter + 1], [docId, Number.MAX_SAFE_INTEGER]))));
        for (const e of commit.entries) puts.push(result(journal.put({ docId, seq: e.seq, text: e.text } satisfies EntryRow)));
        if (commit.fold !== undefined) {
          puts.push(result(tx.objectStore('checkpoints').put({ docId, ...commit.fold } satisfies CheckpointRow)));
          puts.push(result(journal.delete(IDBKeyRange.bound([docId, 0], [docId, commit.fold.seq]))));
        }
        puts.push(result(tx.objectStore('docs').put(commit.meta)));
        await together(puts);
      }),
    load: (docId) =>
      inTransaction(db, ['docs', 'journal', 'checkpoints'], 'readonly', async (tx) => {
        const meta = (await result(tx.objectStore('docs').get(docId))) as DocMeta | undefined;
        if (meta === undefined) return undefined;
        const row = (await result(tx.objectStore('checkpoints').get(docId))) as CheckpointRow | undefined;
        const rows = (await result(tx.objectStore('journal').getAll(IDBKeyRange.bound([docId, 0], [docId, Number.MAX_SAFE_INTEGER])))) as EntryRow[];
        const checkpoint = row === undefined ? {} : { checkpoint: { seq: row.seq, rev: row.rev, records: row.records } };
        const entries = rows.filter((r) => row === undefined || r.seq > row.seq).map((r) => ({ seq: r.seq, text: r.text }));
        return { meta, ...checkpoint, entries } satisfies StoredJournal;
      }),
    setSaved: (docId, rev) =>
      inTransaction(db, ['docs'], 'readwrite', async (tx) => {
        const docs = tx.objectStore('docs');
        const meta = (await result(docs.get(docId))) as DocMeta | undefined;
        if (meta !== undefined) await result(docs.put({ ...meta, savedRev: rev }));
      }),
    discard: (docId) =>
      inTransaction(db, ['docs', 'journal', 'checkpoints'], 'readwrite', async (tx) => {
        await together([
          result(tx.objectStore('docs').delete(docId)),
          result(tx.objectStore('checkpoints').delete(docId)),
          result(tx.objectStore('journal').delete(IDBKeyRange.bound([docId, 0], [docId, Number.MAX_SAFE_INTEGER]))),
        ]);
      }),
    unsaved: () =>
      inTransaction(db, ['docs'], 'readonly', async (tx) => {
        const all = (await result(tx.objectStore('docs').getAll())) as DocMeta[];
        return all.filter((m) => m.headRev > m.savedRev).sort((a, b) => (a.updated < b.updated ? 1 : -1));
      }),
  };
}
