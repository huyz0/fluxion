// The autosave scheduler (FR-FIL-007, NFR-REL-001, ADR-0024): turns the store's committed changes into journal entries and writes them in one
// transaction after a short debounce, never later than the budget allows, folds a long journal into a checkpoint, and keeps trying when storage
// fails. The clock and the timers are parameters, so the 5 s budget is a test on a fake clock, not a hope.
import { type DiffLike, encodeDiff, needsCompaction, type Replayed, readEntry, replay, serializeEntry } from '@fluxion/format';
import type { AnyRecord } from '@fluxion/schema';
import type { AutosaveStore, Checkpoint, StoredEntry, StoredJournal } from './store.js';

/**
 * Quiet time after the last change before the journal is written.
 *
 * @public
 */
export const AUTOSAVE_DEBOUNCE_MS = 2000;
/**
 * The longest a change waits for a write however busy the editing is: the debounce is capped so that, with the write itself, the 5 s budget holds.
 *
 * @public
 */
export const AUTOSAVE_MAX_WAIT_MS = 4000;
/** Waits before a failed write is tried again; after these, every 30 s. */
const BACKOFF_MS = [1000, 2000, 4000] as const;
const BACKOFF_STEADY_MS = 30_000;

/**
 * The clock and timers the scheduler uses.
 *
 * @public
 */
export type Timers = {
  /** Milliseconds, from any origin. */
  now(): number;
  /** Run `fn` after `ms`; returns a handle for `clearTimeout`. */
  setTimeout(fn: () => void, ms: number): unknown;
  /** Cancel a timer. */
  clearTimeout(handle: unknown): void;
};

/**
 * Where autosave stands.
 *
 * @public
 */
export type AutosaveStatus =
  | {
      /** Everything is written. */
      readonly kind: 'saved';
    }
  | {
      /** Changes are waiting for the write. */
      readonly kind: 'pending';
    }
  | {
      /** The last write failed; the changes are kept in memory and the write is tried again. */
      readonly kind: 'failed';
      /** Why, in a line. */
      readonly message: string;
      /** When the next try is, in milliseconds from now. */
      readonly retryInMs: number;
    };

/**
 * What a scheduler needs.
 *
 * @public
 */
export type AutosaveOptions = {
  /** The document's id. */
  readonly docId: string;
  /** Where the journal goes. */
  readonly store: AutosaveStore;
  /** The clock and timers. */
  readonly timers: Timers;
  /** The time as ISO 8601, for the entries and the document's record. */
  readonly iso: () => string;
  /** The document's records right now (a checkpoint is taken from them). */
  readonly records: () => { readonly [id: string]: AnyRecord };
  /** The document's title right now. */
  readonly title: () => string;
  /**
   * The state the journal builds on: the document as opened, at the store revision `rev` (the first write stores it as the checkpoint at the
   * sequence number `seq`, so a recovery never needs the file). Omit when the store already holds a checkpoint for the document.
   */
  readonly base?: { readonly records: { readonly [id: string]: AnyRecord }; readonly rev: number; readonly seq: number };
  /** What the store already holds for the document, when it was opened with work in the journal. */
  readonly stored?: StoredJournal;
};

/**
 * The scheduler of one document's autosave.
 *
 * @public
 */
export interface Autosave {
  /** A change was committed at store revision `rev`: journal it. */
  change(diff: DiffLike, rev: number): void;
  /** Write what is waiting now (the page is being hidden, or the person saved). Resolves when it is written, or when the write failed (see the status). */
  flush(): Promise<void>;
  /** The file was saved at store revision `rev`: write what is waiting, then mark the journal as saved. */
  saved(rev: number): Promise<void>;
  /** Where autosave stands. */
  status(): AutosaveStatus;
  /** Be told whenever the status changes; returns the way to stop. */
  onStatus(listener: (status: AutosaveStatus) => void): () => void;
  /** Stop the timers. */
  dispose(): void;
}

/**
 * The part of a stored journal that reads and follows on from its checkpoint.
 *
 * @public
 */
export type Intact = {
  /** The entries that read and follow on, in order. */
  readonly entries: readonly StoredEntry[];
  /** Where the intact part ends: the last entry's sequence number and revision (the checkpoint's own when there is none). */
  readonly last: { readonly seq: number; readonly rev: number };
  /** Present when something after the intact part could not be used: how many stored entries, and why. */
  readonly torn?: { readonly entries: number; readonly reason: string };
};

/** The intact part of `stored`: entries are read in order, and the first that does not read, or does not follow on, ends it. */
export function intact(stored: StoredJournal): Intact {
  const checkpoint = stored.checkpoint ?? { seq: 0, rev: 0, records: {} };
  const parsed = [];
  let reason: string | undefined;
  for (const e of stored.entries) {
    const read = readEntry(e.text);
    if (!read.ok) {
      reason = `entry ${e.seq}: ${read.reason}`;
      break;
    }
    parsed.push(read.value);
  }
  const replayed = replay(checkpoint, parsed);
  const entries = stored.entries.filter((e) => e.seq > checkpoint.seq && e.seq <= replayed.last.seq);
  const lost = stored.entries.length - entries.length;
  return {
    entries,
    last: replayed.last,
    ...(lost > 0 ? { torn: { entries: lost, reason: reason ?? replayed.stopped?.reason ?? 'the journal does not follow on' } } : {}),
  };
}

/** The total length of the entry texts. */
const sizeOf = (entries: readonly StoredEntry[]): number => entries.reduce((sum, e) => sum + e.text.length, 0);

/** A failure as one line. */
const lineOf = (e: unknown): string => (e instanceof Error ? (e.name === 'Error' ? e.message : `${e.name}: ${e.message}`) : String(e));

/** One document's autosave: the changes waiting, the journal's size, the timer, and where the last write stands. */
class Scheduler implements Autosave {
  private seq: number;
  private headRev: number;
  private savedRev: number;
  private checkpointSeq: number;
  private journalEntries: number;
  private journalBytes: number;
  /** The document as opened, owed to the store as the checkpoint the first entries build on. */
  private baseOwed: Checkpoint | undefined;
  /** The last good sequence number of a torn journal that was reopened: what follows it is dropped with the first write, so new entries follow on. */
  private truncateOwed: number | undefined;
  private pending: StoredEntry[] = [];
  private pendingSince: number | undefined;
  private timer: unknown;
  private failures = 0;
  private writing: Promise<void> = Promise.resolve();
  private current: AutosaveStatus = { kind: 'saved' };
  private readonly listeners = new Set<(s: AutosaveStatus) => void>();

  private readonly o: AutosaveOptions;

  constructor(options: AutosaveOptions) {
    this.o = options;
    const { stored, base } = options;
    const good = stored === undefined ? undefined : intact(stored);
    this.seq = good?.last.seq ?? base?.seq ?? 0;
    this.headRev = good?.last.rev ?? base?.rev ?? 0;
    this.savedRev = stored?.meta.savedRev ?? base?.rev ?? 0;
    this.checkpointSeq = stored?.meta.checkpointSeq ?? base?.seq ?? 0;
    this.journalEntries = good?.entries.length ?? 0;
    this.journalBytes = sizeOf(good?.entries ?? []);
    this.baseOwed = stored?.checkpoint === undefined && base !== undefined ? { seq: base.seq, rev: base.rev, records: base.records } : undefined;
    this.truncateOwed = good?.torn === undefined ? undefined : good.last.seq;
  }

  status = (): AutosaveStatus => this.current;

  onStatus(listener: (status: AutosaveStatus) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  dispose(): void {
    this.disarm();
    this.listeners.clear();
  }

  change(diff: DiffLike, rev: number): void {
    this.seq += 1;
    this.headRev = rev;
    this.pending.push({ seq: this.seq, text: serializeEntry(encodeDiff(diff, { seq: this.seq, rev, at: this.o.iso() })) });
    const now = this.o.timers.now();
    this.pendingSince ??= now;
    // a failing store has its own retry timer; the change just waits with the others
    if (this.current.kind === 'failed') return;
    // quiet for the debounce, but never later than the cap after the first waiting change
    this.arm(Math.min(AUTOSAVE_DEBOUNCE_MS, this.pendingSince + AUTOSAVE_MAX_WAIT_MS - now));
    this.setStatus({ kind: 'pending' });
  }

  flush(): Promise<void> {
    this.disarm();
    // one write at a time: a flush during a write waits for it, then writes what arrived meanwhile
    this.writing = this.writing.then(() => this.write());
    return this.writing;
  }

  async saved(rev: number): Promise<void> {
    await this.flush();
    this.savedRev = rev;
    await this.o.store.setSaved(this.o.docId, rev);
  }

  private setStatus(next: AutosaveStatus): void {
    this.current = next;
    for (const l of this.listeners) l(next);
  }

  private disarm(): void {
    if (this.timer !== undefined) this.o.timers.clearTimeout(this.timer);
    this.timer = undefined;
  }

  private arm(ms: number): void {
    this.disarm();
    this.timer = this.o.timers.setTimeout(
      () => {
        this.timer = undefined;
        void this.flush();
      },
      Math.max(0, ms),
    );
  }

  /** The checkpoint this write carries: the base the first entries build on, else a fold when the journal has grown long, else none. */
  private checkpointFor(batch: readonly StoredEntry[]): Checkpoint | undefined {
    if (this.baseOwed !== undefined) return this.baseOwed;
    const grown = needsCompaction({ entries: this.journalEntries + batch.length, bytes: this.journalBytes + sizeOf(batch) });
    return grown ? { seq: batch.at(-1)?.seq ?? this.seq, rev: this.headRev, records: this.o.records() } : undefined;
  }

  private async write(): Promise<void> {
    // a copy: changes made while the store is writing are pushed onto the waiting list, and are not part of this write
    const batch = [...this.pending];
    if (batch.length === 0) return;
    try {
      const fold = this.checkpointFor(batch);
      const meta = {
        docId: this.o.docId,
        title: this.o.title(),
        savedRev: this.savedRev,
        headRev: this.headRev,
        updated: this.o.iso(),
        checkpointSeq: fold?.seq ?? this.checkpointSeq,
      };
      const truncateAfter = this.truncateOwed;
      await this.o.store.commit(this.o.docId, {
        entries: batch,
        meta,
        ...(fold === undefined ? {} : { fold }),
        ...(truncateAfter === undefined ? {} : { truncateAfter }),
      });
      if (truncateAfter !== undefined) this.truncateOwed = undefined;
      this.written(batch, fold);
    } catch (e) {
      // anything that goes wrong in a write, the store's rejection or a caller's function, is a failed write that is tried again: the chain never dies
      this.failed(e);
    }
  }

  private failed(e: unknown): void {
    this.failures += 1;
    const retryInMs = BACKOFF_MS[this.failures - 1] ?? BACKOFF_STEADY_MS;
    this.setStatus({ kind: 'failed', message: lineOf(e), retryInMs });
    this.arm(retryInMs);
  }

  private written(batch: readonly StoredEntry[], fold: Checkpoint | undefined): void {
    this.failures = 0;
    this.pending = this.pending.slice(batch.length);
    // a fold at or past the last entry empties the journal; the base (at the state before the first entry) leaves the entries in it
    const emptied = fold !== undefined && fold.seq >= (batch.at(-1)?.seq ?? 0);
    this.journalEntries = emptied ? 0 : this.journalEntries + batch.length;
    this.journalBytes = emptied ? 0 : this.journalBytes + sizeOf(batch);
    this.checkpointSeq = fold?.seq ?? this.checkpointSeq;
    if (fold === this.baseOwed) this.baseOwed = undefined;
    this.pendingSince = this.pending.length > 0 ? this.o.timers.now() : undefined;
    if (this.pending.length > 0) this.arm(AUTOSAVE_DEBOUNCE_MS);
    this.setStatus(this.pending.length > 0 ? { kind: 'pending' } : { kind: 'saved' });
  }
}

/**
 * Autosave for one document.
 *
 * @public
 */
export const createAutosave = (options: AutosaveOptions): Autosave => new Scheduler(options);

/**
 * What a recovery found.
 *
 * @public
 */
export type Recovery = {
  /** The records after the last entry that replayed. */
  readonly records: Replayed['records'];
  /** The store revision they stand at. */
  readonly rev: number;
  /** True when the journal holds changes the file does not (head revision beyond the saved one). */
  readonly unsaved: boolean;
  /** How many entries replayed. */
  readonly applied: number;
  /** Present when the journal was cut short (a torn entry, a gap): what was dropped. */
  readonly dropped?: { readonly entries: number; readonly reason: string };
  /** The document's title, for the prompt. */
  readonly title: string;
  /** When autosave last wrote, ISO 8601. */
  readonly updated: string;
};

/**
 * The document a journal rebuilds: the checkpoint and the entries after it, up to the last that reads and follows on. Undefined when the store holds
 * no checkpoint (nothing to build on).
 *
 * @public
 */
export function recover(stored: StoredJournal): Recovery | undefined {
  if (stored.checkpoint === undefined) return undefined;
  const good = intact(stored);
  const replayed = replay(
    stored.checkpoint,
    good.entries.map((e) => {
      const read = readEntry(e.text);
      return read.ok ? read.value : { seq: e.seq, rev: 0, at: '', puts: [], deletes: [] };
    }),
  );
  return {
    records: replayed.records,
    rev: replayed.last.rev,
    unsaved: replayed.last.rev > stored.meta.savedRev,
    applied: replayed.applied,
    ...(good.torn === undefined ? {} : { dropped: good.torn }),
    title: stored.meta.title,
    updated: stored.meta.updated,
  };
}
