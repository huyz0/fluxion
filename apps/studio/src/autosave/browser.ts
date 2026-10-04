// The autosave on this browser's storage (FR-FIL-007, ADR-0024): the IndexedDB journal where there is one, OPFS for bytes and versions where it can
// write files, and what the person is told when neither is there. A browser that refuses storage still edits; it just says nothing is kept.
import type { Timers } from './autosave.js';
import { type BlobStore, memoryBlobs, opfsBlobs } from './blobs.js';
import { type LockPort, webLocks } from './document-autosave.js';
import { idbAutosaveStore } from './idb-store.js';
import { type AutosaveStore, memoryAutosaveStore } from './store.js';

/**
 * Everything `startDocumentAutosave` needs from the browser.
 *
 * @public
 */
export type BrowserAutosave = {
  /** The journal. */
  readonly journal: AutosaveStore;
  /** True when the journal is on IndexedDB; false for the memory fallback. */
  readonly durable: boolean;
  /** Where asset bytes go, if anywhere. */
  readonly blobs?: BlobStore;
  /** Whether versions can be written (OPFS only). */
  readonly snapshots: boolean;
  /** Per-document locks. */
  readonly lock: LockPort;
  /** Ask the browser to keep the storage. */
  readonly persist: () => Promise<boolean>;
  /** The real clock. */
  readonly timers: Timers;
  /** The time as ISO 8601. */
  readonly iso: () => string;
  /** Let go of the database connection. */
  readonly close: () => void;
};

/**
 * What the browser offers (all optional, so a test can take things away).
 *
 * @public
 */
export type BrowserEnv = {
  /** The IndexedDB factory. */
  readonly indexedDB?: IDBFactory | undefined;
  /** The storage manager (OPFS, persistence). */
  readonly storage?: StorageManager | undefined;
  /** The Web Locks. */
  readonly locks?: LockManager | undefined;
};

const realTimers: Timers = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const canWriteFiles = (): boolean => typeof FileSystemFileHandle !== 'undefined' && 'createWritable' in FileSystemFileHandle.prototype;

async function opfs(storage: StorageManager | undefined): Promise<BlobStore | undefined> {
  if (storage === undefined || typeof storage.getDirectory !== 'function' || !canWriteFiles()) return undefined;
  try {
    return opfsBlobs(await (await storage.getDirectory()).getDirectoryHandle('fluxion', { create: true }));
  } catch {
    return undefined;
  }
}

/**
 * Open the browser's storage for autosave: never rejects. IndexedDB that refuses (a private window) falls back to a journal in memory, and the
 * result says it is not durable.
 *
 * @public
 */
export async function browserAutosave(env: BrowserEnv = {}): Promise<BrowserAutosave> {
  const factory = 'indexedDB' in env ? env.indexedDB : typeof indexedDB === 'undefined' ? undefined : indexedDB;
  const storage = 'storage' in env ? env.storage : typeof navigator === 'undefined' ? undefined : navigator.storage;
  const locks = 'locks' in env ? env.locks : undefined;
  const lock = webLocks(locks);
  const persist = async (): Promise<boolean> => {
    if (storage === undefined || typeof storage.persist !== 'function') return false;
    return (await storage.persisted?.()) === true || (await storage.persist());
  };
  const base = { lock, persist, timers: realTimers, iso: () => new Date().toISOString() };
  let idb: Awaited<ReturnType<typeof idbAutosaveStore>> | undefined;
  try {
    idb = factory === undefined ? undefined : await idbAutosaveStore(factory);
  } catch {
    idb = undefined;
  }
  if (idb === undefined) return { ...base, journal: memoryAutosaveStore(), durable: false, snapshots: false, blobs: memoryBlobs(), close: () => undefined };
  const files = await opfs(storage);
  return { ...base, journal: idb, durable: true, snapshots: files !== undefined, blobs: files ?? idb.blobs, close: () => idb.close() };
}
