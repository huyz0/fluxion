// The autosave store (FR-FIL-007, ADR-0024): where the journal, its checkpoint and each document's bookkeeping live. A port, so the scheduler is
// tested with an in-memory store and the studio runs on IndexedDB (idb-store.ts). Every write is one transaction: the new entries, the document's
// record and, when the journal is folded, the checkpoint and the removal of the entries it replaces either all happen or none do.
import type { AnyRecord } from '@fluxion/schema';

/**
 * What the store keeps about one document.
 *
 * @public
 */
export type DocMeta = {
  /** The document's id in the studio. */
  readonly docId: string;
  /** Its title, for the recovery prompt. */
  readonly title: string;
  /** The store revision the last explicit save of the file covered. */
  readonly savedRev: number;
  /** The store revision of the newest journal entry. */
  readonly headRev: number;
  /** When the store last wrote, ISO 8601. */
  readonly updated: string;
  /** The sequence number the checkpoint stands at. */
  readonly checkpointSeq: number;
};

/**
 * The records of a document at one point in the journal.
 *
 * @public
 */
export type Checkpoint = {
  /** The last entry the records include (0 for the state at open). */
  readonly seq: number;
  /** The store revision at that point. */
  readonly rev: number;
  /** Every record. */
  readonly records: { readonly [id: string]: AnyRecord };
};

/**
 * One journal entry as stored: its place and its text.
 *
 * @public
 */
export type StoredEntry = {
  /** The entry's sequence number. */
  readonly seq: number;
  /** The entry as `serializeEntry` wrote it. */
  readonly text: string;
};

/**
 * One write.
 *
 * @public
 */
export type Commit = {
  /** The entries to add, in order. */
  readonly entries: readonly StoredEntry[];
  /** The document's record after the write. */
  readonly meta: DocMeta;
  /** When given: replace the checkpoint with this one and drop the entries it covers (`seq` and below), in the same transaction. */
  readonly fold?: Checkpoint;
  /** When given: first drop every stored entry after this sequence number (a torn tail that a recovery did not use), in the same transaction. */
  readonly truncateAfter?: number;
};

/**
 * What the store holds for a document.
 *
 * @public
 */
export type StoredJournal = {
  /** The document's record. */
  readonly meta: DocMeta;
  /** The checkpoint, if one was written. */
  readonly checkpoint?: Checkpoint;
  /** The entries after the checkpoint, in sequence order. */
  readonly entries: readonly StoredEntry[];
};

/**
 * The storage the autosave writes to.
 *
 * @public
 */
export interface AutosaveStore {
  /** Apply `commit` for `docId` in one transaction. A rejection leaves the store as it was. */
  commit(docId: string, commit: Commit): Promise<void>;
  /** What is stored for `docId`, or undefined. */
  load(docId: string): Promise<StoredJournal | undefined>;
  /** Record that the file was saved at store revision `rev`. */
  setSaved(docId: string, rev: number): Promise<void>;
  /** Forget everything stored for `docId`. */
  discard(docId: string): Promise<void>;
  /** The ids of the documents with unsaved work (head revision beyond the saved one), newest first. */
  unsaved(): Promise<readonly DocMeta[]>;
}

/**
 * A store in memory, for tests and for a browser that has no IndexedDB. `failNext` makes the next writes reject (a full disk, a private window).
 *
 * @public
 */
export type MemoryAutosaveStore = AutosaveStore & {
  /** Make the next `count` commits reject with `error`. */
  failNext(count: number, error: Error): void;
  /** Make the next commit wait until `release` is called (a write that takes time), so a test can change things while it is in flight. */
  holdNext(): { readonly release: () => void };
  /** How many commits applied. */
  readonly commits: () => number;
};

/**
 * An empty in-memory store.
 *
 * @public
 */
export function memoryAutosaveStore(): MemoryAutosaveStore {
  const docs = new Map<string, { meta: DocMeta; checkpoint?: Checkpoint; entries: StoredEntry[] }>();
  let failures: { count: number; error: Error } | undefined;
  let applied = 0;
  let held: Promise<void> | undefined;
  return {
    holdNext() {
      let release: () => void = () => undefined;
      held = new Promise<void>((resolve) => {
        release = resolve;
      });
      return { release };
    },
    failNext(count, error) {
      failures = { count, error };
    },
    commits: () => applied,
    async commit(docId, commit) {
      if (held !== undefined) {
        const waiting = held;
        held = undefined;
        await waiting;
      }
      if (failures !== undefined && failures.count > 0) {
        failures.count -= 1;
        throw failures.error;
      }
      const stored = docs.get(docId) ?? { meta: commit.meta, entries: [] };
      const kept = stored.entries.filter((e) => commit.truncateAfter === undefined || e.seq <= commit.truncateAfter);
      const entries = [...kept, ...commit.entries].filter((e) => commit.fold === undefined || e.seq > commit.fold.seq);
      const checkpoint = commit.fold ?? stored.checkpoint;
      docs.set(docId, { meta: commit.meta, ...(checkpoint === undefined ? {} : { checkpoint }), entries });
      applied += 1;
    },
    load(docId) {
      const held = docs.get(docId);
      return Promise.resolve(
        held === undefined
          ? undefined
          : { meta: held.meta, ...(held.checkpoint === undefined ? {} : { checkpoint: held.checkpoint }), entries: [...held.entries] },
      );
    },
    setSaved(docId, rev) {
      const held = docs.get(docId);
      if (held !== undefined) docs.set(docId, { ...held, meta: { ...held.meta, savedRev: rev } });
      return Promise.resolve();
    },
    discard(docId) {
      docs.delete(docId);
      return Promise.resolve();
    },
    unsaved() {
      const metas = [...docs.values()].map((d) => d.meta).filter((m) => m.headRev > m.savedRev);
      return Promise.resolve(metas.sort((a, b) => (a.updated < b.updated ? 1 : -1)));
    },
  };
}
