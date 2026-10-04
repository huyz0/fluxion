// One open document's protection (FR-FIL-007, NFR-REL-001, ADR-0024): takes the document's lock so a second tab opens it read-only, asks the
// browser to keep the storage, journals each committed change, and writes a version snapshot every 10 minutes of editing and on each explicit save.
import type { Store } from '@fluxion/core';
import type { AnyRecord } from '@fluxion/schema';
import { putAssetBytes } from './asset-bytes.js';
import { type Autosave, type AutosaveStatus, createAutosave, type Timers } from './autosave.js';
import type { BlobStore } from './blobs.js';
import { SNAPSHOT_INTERVAL_MS, snapshotDue, writeSnapshot } from './snapshots.js';
import type { AutosaveStore, StoredJournal } from './store.js';

/**
 * Whether a document is being held, or is held by another tab. `acquire` resolves to a release function, or undefined when another tab has it.
 *
 * @public
 */
export interface LockPort {
  /** Take the lock called `name` without waiting. */
  acquire(name: string): Promise<(() => void) | undefined>;
}

/**
 * The lock port on the browser's Web Locks: held until released (or the tab goes away). A browser without them gets no locking: every tab may edit,
 * as before.
 *
 * @public
 */
export function webLocks(locks: LockManager | undefined = typeof navigator === 'undefined' ? undefined : navigator.locks): LockPort {
  return {
    acquire(name) {
      if (locks === undefined) return Promise.resolve(() => undefined);
      return new Promise((resolve, reject) => {
        void locks
          .request(name, { mode: 'exclusive', ifAvailable: true }, (lock) => {
            if (lock === null) {
              resolve(undefined);
              return undefined;
            }
            return new Promise<void>((release) => resolve(() => release()));
          })
          .catch(reject);
      });
    },
  };
}

/**
 * How well the browser promises to keep what autosave wrote: `protected` (storage is persistent), `may-be-cleared` (the browser may evict it
 * under pressure) or `unavailable` (nothing could be stored: a private window, or no IndexedDB).
 *
 * @public
 */
export type Protection = 'protected' | 'may-be-cleared' | 'unavailable';

/**
 * What the status line shows.
 *
 * @public
 */
export type AutosaveState = {
  /** How durable the storage is. */
  readonly protection: Protection;
  /** Where the last write stands. */
  readonly write: AutosaveStatus;
};

/**
 * What a document's protection needs.
 *
 * @public
 */
export type DocumentAutosaveOptions = {
  /** The document's id in the studio. */
  readonly docId: string;
  /** Its records. */
  readonly store: Pick<Store, 'ids' | 'get' | 'subscribe'>;
  /** The title now. */
  readonly title: () => string;
  /** Where the journal goes. */
  readonly journal: AutosaveStore;
  /** True when the journal is on real browser storage; false for the memory fallback. */
  readonly durable: boolean;
  /** Where asset bytes and snapshots go, when the browser has a place for them. */
  readonly blobs?: BlobStore;
  /** Whether snapshots may be written (OPFS only; the assets-store fallback keeps bytes but no versions). */
  readonly snapshots: boolean;
  /** The lock port. */
  readonly lock: LockPort;
  /** Ask the browser to keep the storage (`navigator.storage.persist`); resolves to whether it will. */
  readonly persist: () => Promise<boolean>;
  /** The clock and timers. */
  readonly timers: Timers;
  /** The time as ISO 8601 UTC with milliseconds. */
  readonly iso: () => string;
  /** The whole document as `.flux` bytes (a snapshot's content). */
  readonly flux: () => Promise<Uint8Array>;
  /** What the journal already holds for this document (the person is working on a recovered one). */
  readonly stored?: StoredJournal;
};

/**
 * A document's autosave while it is open.
 *
 * @public
 */
export interface DocumentAutosave {
  /** The state for the status line. */
  state(): AutosaveState;
  /** Be told when it changes; returns the way to stop. */
  onState(listener: (state: AutosaveState) => void): () => void;
  /** The person saved the file: journal what is waiting, mark it saved and keep a version. */
  saved(): Promise<void>;
  /** Keep the bytes of an asset (by sha256) so a recovered document has them. */
  keepAsset(hash: string, bytes: Uint8Array): Promise<void>;
  /** Write what is waiting now (the page is being hidden). */
  flush(): Promise<void>;
  /** Stop and let go of the lock. */
  stop(): void;
}

/**
 * The outcome of opening a document for editing.
 *
 * @public
 */
export type Started =
  | {
      /** This tab holds the document. */
      readonly kind: 'editing';
      /** Its autosave. */
      readonly autosave: DocumentAutosave;
    }
  | {
      /** Another tab holds the document: open it read-only. */
      readonly kind: 'read-only';
    };

const recordsOf = (store: Pick<Store, 'ids' | 'get'>): { [id: string]: AnyRecord } => {
  const out: { [id: string]: AnyRecord } = {};
  for (const id of store.ids()) {
    const record = store.get(id);
    if (record !== undefined) out[id] = record;
  }
  return out;
};

/** The version snapshots of an open document: one every interval while there are changes, and one on demand. */
function keepVersions(o: DocumentAutosaveOptions): { changed(): void; now(): Promise<void>; stop(): void } {
  let last = o.timers.now();
  let dirty = false;
  let timer: unknown;
  const now = async (): Promise<void> => {
    if (!o.snapshots || o.blobs === undefined) return;
    // cleared before the bytes are taken: a change made while the write is in flight keeps the document due for the next version
    dirty = false;
    try {
      await writeSnapshot(o.blobs, o.docId, o.iso(), await o.flux());
      last = o.timers.now();
    } catch {
      // versions are a convenience on top of the file and the journal: a failed one is tried again at the next interval
      dirty = true;
    }
  };
  const arm = (): void => {
    timer = o.timers.setTimeout(() => {
      if (snapshotDue(last, o.timers.now(), dirty)) void now();
      arm();
    }, SNAPSHOT_INTERVAL_MS);
  };
  arm();
  return {
    changed: () => {
      dirty = true;
    },
    now,
    stop: () => o.timers.clearTimeout(timer),
  };
}

/**
 * Start protecting a document: take its lock (or say it is held), then journal its changes.
 *
 * @public
 */
export async function startDocumentAutosave(o: DocumentAutosaveOptions): Promise<Started> {
  const release = await o.lock.acquire(`fluxion-doc:${o.docId}`);
  if (release === undefined) return { kind: 'read-only' };
  let rev = o.stored?.meta.headRev ?? 0;
  const autosave: Autosave = createAutosave({
    docId: o.docId,
    store: o.journal,
    timers: o.timers,
    iso: o.iso,
    records: () => recordsOf(o.store),
    title: o.title,
    ...(o.stored === undefined ? { base: { records: recordsOf(o.store), rev, seq: 0 } } : { stored: o.stored }),
  });
  let protection: Protection = o.durable ? 'may-be-cleared' : 'unavailable';
  const listeners = new Set<(s: AutosaveState) => void>();
  const state = (): AutosaveState => ({ protection, write: autosave.status() });
  const announce = (): void => {
    for (const l of listeners) l(state());
  };
  autosave.onStatus(announce);
  if (o.durable)
    void o.persist().then(
      (kept) => {
        protection = kept ? 'protected' : 'may-be-cleared';
        announce();
      },
      () => undefined,
    );
  const versions = keepVersions(o);
  const unsubscribe = o.store.subscribe((diff) => {
    rev += 1;
    versions.changed();
    autosave.change(diff, rev);
  });
  let stopped = false;
  return {
    kind: 'editing',
    autosave: {
      state,
      onState(listener) {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
      async saved() {
        await autosave.saved(rev);
        await versions.now();
        announce();
      },
      async keepAsset(hash, bytes) {
        if (o.blobs !== undefined) await putAssetBytes(o.blobs, hash, bytes);
      },
      flush: () => autosave.flush(),
      stop() {
        if (stopped) return;
        stopped = true;
        unsubscribe();
        versions.stop();
        autosave.dispose();
        listeners.clear();
        release();
      },
    },
  };
}
