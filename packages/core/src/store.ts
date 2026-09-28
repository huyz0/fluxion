// The record store (ADR-0002, 03-core-engine §1): a flat map of frozen records with one signal per
// record, so a change notifies only that record's readers (NFR-MNT-006). `transact` is the only
// write path (ADR-0014).
import { type AnyRecord, type Diagnostic, type DocumentFile, err, ok, type RecordId, type Result } from '@fluxion/schema';
import { type History, StoreHistory } from './history.js';
import type { IntegrityHook } from './hook-types.js';
import { pendingMembers } from './hooks.js';
import { Indexes, type IndexName } from './indexes.js';
import { SharedRecordMap } from './record-map.js';
import type { Registry } from './registry.js';
import { batch, computed, type ReadSignal, type WritableSignal, writable } from './signals.js';
import {
  checkDiff,
  cloneJson,
  type Diff,
  deepFreeze,
  jsonEqual,
  netDiff,
  type PutChange,
  referentialErrors,
  type Tx,
  type TxFailure,
  type TxMeta,
  type TxOptions,
  WorkingCopy,
} from './transaction.js';

/**
 * What a {@link Store.query} function reads: every read is tracked, so the query re-runs when
 * anything it read changes (a record through `get`/`has`, the id set through `ids`/`size`,
 * an index key through `members`).
 *
 * @public
 */
export type ReadView = {
  /** The record with `id`; tracks that record. */
  get(id: RecordId): AnyRecord | undefined;
  /** Whether `id` exists; tracks that record. */
  has(id: RecordId): boolean;
  /** Every record id; tracks additions and removals. */
  ids(): RecordId[];
  /** Number of records; tracks additions and removals. */
  readonly size: number;
  /** Ids under `key` in `index`; tracks that key. */
  members(index: IndexName, key: string): RecordId[];
};

/**
 * A document's records: read them, watch them, and change them through transactions.
 *
 * @public
 */
export interface Store {
  /** The record with `id`, frozen, or undefined. */
  get(id: RecordId): AnyRecord | undefined;
  /** Whether a record with `id` exists. */
  has(id: RecordId): boolean;
  /** Number of records. */
  readonly size: number;
  /** Every record id, in insertion order. */
  ids(): RecordId[];
  /** A signal of the record with `id` (undefined while absent); it changes only when that record does. */
  record$(id: RecordId): ReadSignal<AnyRecord | undefined>;
  /** The document file: the envelope it was created from, with the current records. */
  toDocument(): DocumentFile;
  /**
   * Run `fn` as one transaction (ADR-0014): its net diff is validated, then applied and announced
   * once. On an invalid result nothing changes and the failure carries the diagnostics; a throw
   * from `fn` rolls back and is rethrown. A call inside an open transaction joins it.
   */
  transact<R>(label: string, fn: (tx: Tx) => R, options?: TxOptions): Result<R, TxFailure>;
  /** Call `listener` after every committed transaction with a non-empty diff; returns an unsubscribe. */
  subscribe(listener: (diff: Diff, meta: TxMeta) => void): () => void;
  /**
   * Ids filed under `key` in `index` (elements by screen or parent, records by type, bindings by
   * element), in no particular order. Inside {@link Store.query} or an effect it subscribes to that key.
   */
  members(index: IndexName, key: string): RecordId[];
  /** Undo and redo of this store's user and system transactions (ADR-0014 §History). */
  readonly history: History;
  /** Whether the store refuses every write (policy `read-only`; TX_READ_ONLY). */
  readonly readOnly: boolean;
  /**
   * A store that starts from this one's current state (O(1), copy-on-write, ADR-0014 §Forks): writes
   * to it never reach this store, and this store's later writes are not visible in it. A fork is a
   * preview, so it is read-write even when this store is read-only.
   */
  fork(): Store;
  /**
   * For a fork of `parent`: the net change since it was forked, against the fork-time snapshot (so
   * applying it to the parent keeps the parent's own concurrent edits); undefined when this store is
   * not a fork of `parent`.
   */
  diffFrom(parent: Store): Diff | undefined;
  /** A memoized reactive query over a tracked {@link ReadView}: re-runs only when something it read changes. */
  query<T>(fn: (view: ReadView) => T): ReadSignal<T>;
}

/**
 * Options of {@link createStore}.
 *
 * @public
 */
export type StoreOptions = {
  /** Validate every transaction (default true); only production builds may switch it off (ADR-0014). */
  readonly validate?: boolean;
  /** Integrity hooks to run in every transaction except undo and redo (ADR-0014). */
  readonly hooks?: Registry<string, IntegrityHook>;
  /** `read-only` refuses every transaction and command with TX_READ_ONLY (default `read-write`). */
  readonly policy?: 'read-write' | 'read-only';
};

/** What a fork starts from (core-internal). */
type ForkSeed = {
  readonly parent: Store;
  readonly data: SharedRecordMap;
  readonly base: SharedRecordMap;
  readonly envelope: Omit<DocumentFile, 'records'>;
  readonly known: Map<string, Diagnostic> | undefined;
};

/** The diagnostic of a refused write on a read-only store. */
const READ_ONLY: Diagnostic = { code: 'FLX_READ_ONLY', severity: 'error', path: '', message: 'the document is read-only' };

/** Passes after which non-converging hooks end the transaction with TX_HOOK_DEPTH (ADR-0014). */
const MAX_HOOK_PASSES = 8;

/**
 * Whether two working-copy change maps hold equal values: a hook that re-writes a value that is
 * already right changes nothing, so the fixed point is reached (M3 cp1 F5).
 */
function sameChanges(a: ReadonlyMap<RecordId, AnyRecord | null>, b: ReadonlyMap<RecordId, AnyRecord | null>): boolean {
  return a.size === b.size && [...a].every(([id, v]) => b.has(id) && jsonEqual(b.get(id), v));
}

/** The store implementation; `apply` is core-internal (transactions and history call it). */
export class RecordStore implements Store {
  readonly #data: SharedRecordMap;
  // a fork's own share of the fork-time map: while it is held, every writer copies first
  readonly #base: SharedRecordMap | undefined;
  readonly #parent: Store | undefined;
  readonly #options: StoreOptions;
  readonly #signals = new Map<RecordId, WritableSignal<AnyRecord | undefined>>();
  readonly #listeners = new Set<(diff: Diff, meta: TxMeta) => void>();
  readonly #envelope: Omit<DocumentFile, 'records'>;
  readonly #validate: boolean;
  readonly #hooks: Registry<string, IntegrityHook> | undefined;
  // built on first use, so forking stays O(1)
  #indexCache: Indexes | undefined;
  readonly #history: StoreHistory = new StoreHistory(this, (label, fn, options) => this.#replayable(label, fn, options ?? {}));
  // bumped when a record is added or removed (tracked ids/size); a plain counter, never read tracked
  readonly #membership: WritableSignal<number> = writable(0);
  #memberships = 0;
  #open: WorkingCopy | undefined;
  // referential errors the document already has (computed on first use), so they do not block
  // unrelated transactions; replaced by the post-state's after each commit
  #knownErrors: Map<string, Diagnostic> | undefined;

  constructor(file: DocumentFile, options: StoreOptions = {}, seed?: ForkSeed) {
    this.#options = options;
    this.#validate = options.validate ?? true;
    this.#hooks = options.hooks;
    if (seed) {
      this.#data = seed.data;
      this.#base = seed.base;
      this.#parent = seed.parent;
      this.#envelope = seed.envelope;
      this.#knownErrors = seed.known;
      return;
    }
    const { records, ...envelope } = cloneJson(file);
    this.#envelope = envelope;
    this.#base = undefined;
    this.#parent = undefined;
    // map keys are the record ids (validate() reports a key/id mismatch as FLX_ID_MISMATCH)
    const map = new Map<RecordId, AnyRecord>();
    for (const [id, record] of Object.entries<AnyRecord>(records)) map.set(id as RecordId, deepFreeze(record));
    this.#data = new SharedRecordMap(map);
  }

  get #records(): ReadonlyMap<RecordId, AnyRecord> {
    return this.#data.map;
  }

  get #indexes(): Indexes {
    this.#indexCache ??= new Indexes(this.#records.values());
    return this.#indexCache;
  }

  get readOnly(): boolean {
    return this.#options.policy === 'read-only';
  }

  fork(): Store {
    const seed: ForkSeed = { parent: this, data: this.#data.share(), base: this.#data.share(), envelope: this.#envelope, known: this.#knownErrors };
    // a fork is a preview: editable even when this store is read-only
    return new RecordStore({ schemaVersion: '', records: {} } as DocumentFile, { ...this.#options, policy: 'read-write' }, seed);
  }

  diffFrom(parent: Store): Diff | undefined {
    const base = this.#base?.map;
    if (!base || parent !== this.#parent) return undefined;
    const puts = new Map<RecordId, PutChange>();
    const deletes = new Map<RecordId, AnyRecord>();
    for (const [id, after] of this.#records) {
      const before = base.get(id);
      // unchanged records keep their (immutable) object, so identity settles most of them
      if (before === after || jsonEqual(before, after)) continue;
      puts.set(id, before ? { before, after } : { after });
    }
    for (const [id, before] of base) if (!this.#records.has(id)) deletes.set(id, before);
    return { puts, deletes };
  }

  get history(): History {
    return this.#history;
  }

  members(index: IndexName, key: string): RecordId[] {
    return this.#indexes.members(index, key);
  }

  query<T>(fn: (view: ReadView) => T): ReadSignal<T> {
    return computed(() => fn(this.#view));
  }

  // the tracked view a query reads (M3.12 review r2 F1: plain get/has/ids would go stale)
  readonly #view: ReadView = {
    get: (id) => this.record$(id)(),
    has: (id) => this.record$(id)() !== undefined,
    ids: () => {
      this.#membership.get();
      return this.ids();
    },
    get size() {
      return this.ids().length;
    },
    members: (index, key) => this.members(index, key),
  };

  /** Every index as sorted plain data (core-internal; tests compare it with rebuilt indexes). */
  indexSnapshot(): ReturnType<Indexes['snapshot']> {
    return this.#indexes.snapshot();
  }

  get(id: RecordId): AnyRecord | undefined {
    return this.#records.get(id);
  }

  has(id: RecordId): boolean {
    return this.#records.has(id);
  }

  get size(): number {
    return this.#records.size;
  }

  ids(): RecordId[] {
    return [...this.#records.keys()];
  }

  record$(id: RecordId): ReadSignal<AnyRecord | undefined> {
    let s = this.#signals.get(id);
    if (!s) {
      s = writable(this.#records.get(id));
      this.#signals.set(id, s);
    }
    return s.get;
  }

  toDocument(): DocumentFile {
    return { ...cloneJson(this.#envelope), records: cloneJson(Object.fromEntries(this.#records)) } as DocumentFile;
  }

  transact<R>(label: string, fn: (tx: Tx) => R, options: TxOptions = {}): Result<R, TxFailure> {
    // undo and redo skip the hooks and are not recorded: only the history module replays with them,
    // through #replayable (M4.4 review F3)
    if (options.origin === 'undo' || options.origin === 'redo') {
      const message = `origin "${options.origin}" is reserved for the history module`;
      return err({ code: 'TX_INVALID', message: `${label}: ${message}`, diagnostics: [{ code: 'FLX_ORIGIN_RESERVED', severity: 'error', path: '', message }] });
    }
    return this.#replayable(label, fn, options);
  }

  /** `transact` without the origin check: the history module's entry point (undo/redo replays). */
  #replayable<R>(label: string, fn: (tx: Tx) => R, options: TxOptions): Result<R, TxFailure> {
    // nested: join the open transaction; its commit is the authoritative result (ADR-0014). A throw
    // from the inner fn undoes the inner writes only (a savepoint), then propagates.
    if (this.#open) return ok(this.#open.savepoint(fn));
    if (this.readOnly) return err({ code: 'TX_READ_ONLY', message: `${label}: the store is read-only`, diagnostics: [READ_ONLY] });
    const tx = new WorkingCopy((id) => this.#records.get(id));
    this.#open = tx;
    let value: R;
    try {
      value = fn(tx);
      const replay = options.origin === 'undo' || options.origin === 'redo';
      if (!replay && !this.#runHooks(tx)) {
        return err({ code: 'TX_HOOK_DEPTH', message: `${label}: integrity hooks did not settle in ${MAX_HOOK_PASSES} passes`, diagnostics: [] });
      }
    } finally {
      this.#open = undefined;
      // a Tx kept past its transaction (an async fn, a stored reference) must not lose writes silently
      tx.close();
    }
    return this.#commit(label, tx, options, value);
  }

  /** Validate, apply and announce a finished working copy; `value` is the fn's result. */
  #commit<R>(label: string, tx: WorkingCopy, options: TxOptions, value: R): Result<R, TxFailure> {
    const diff = netDiff(tx.changes, (id) => this.#records.get(id));
    if (diff.puts.size === 0 && diff.deletes.size === 0) return ok(value);
    if (this.#validate) {
      const problems = this.#check(diff);
      if (problems.length) return err({ code: 'TX_INVALID', message: `${label}: ${problems.length} validation error(s)`, diagnostics: problems });
    }
    this.apply(
      [...diff.puts.values()].map((p) => p.after),
      [...diff.deletes.keys()],
    );
    const meta: TxMeta = { ...options, label, origin: options.origin ?? 'user' };
    // history records inside the commit, before any subscriber can react (M3.11 review F1)
    this.#history.record(diff, meta);
    for (const listener of [...this.#listeners]) listener(diff, meta);
    return ok(value);
  }

  subscribe(listener: (diff: Diff, meta: TxMeta) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Run the hooks, sorted by key, until a pass writes nothing; false when that takes too many passes. */
  #runHooks(tx: WorkingCopy): boolean {
    const hooks = this.#hooks?.list() ?? [];
    if (!hooks.length) return true;
    for (let pass = 0; pass < MAX_HOOK_PASSES; pass++) {
      const before = new Map(tx.changes);
      const diff = netDiff(tx.changes, (id) => this.#records.get(id));
      const deleted = new Map([...diff.deletes, ...[...tx.dropped].filter(([id]) => tx.changes.get(id) === null)]);
      const members = pendingMembers((index, key) => this.#indexes.peek(index, key), tx.changes, tx);
      for (const [, hook] of hooks) hook({ tx, diff, deleted, members });
      if (sameChanges(before, tx.changes)) return true;
    }
    return false;
  }

  /** Validation problems of `diff`; on none, the post-state's referential errors become the known ones. */
  #check(diff: Diff): readonly Diagnostic[] {
    this.#knownErrors ??= referentialErrors(this.#records);
    const post = new Map(this.#records);
    for (const [id, { after }] of diff.puts) post.set(id, after);
    for (const id of diff.deletes.keys()) post.delete(id);
    const { problems, after } = checkDiff(diff, post, this.#knownErrors);
    if (!problems.length) this.#knownErrors = after;
    return problems;
  }

  /** Replace or add `puts` and remove `deletes`, then notify each changed record's signal once. */
  apply(puts: readonly AnyRecord[], deletes: readonly RecordId[]): void {
    batch(() => {
      // indexes are maintained here, not by a subscriber: they can never miss or reorder a change
      const added = puts.filter((record) => !this.#records.has(record.id as RecordId)).length;
      for (const record of puts) this.#write(record.id as RecordId, record);
      for (const id of deletes) this.#write(id, undefined);
      if (added > 0 || deletes.length > 0) this.#membership.set(++this.#memberships);
      for (const record of puts) this.#signals.get(record.id as RecordId)?.set(this.#records.get(record.id as RecordId));
      for (const id of deletes) this.#signals.get(id)?.set(undefined);
    });
  }

  /** Store `record` under `id` (undefined removes it) and move it in the indexes. */
  #write(id: RecordId, record: AnyRecord | undefined): void {
    this.#indexCache?.update(this.#records.get(id), record);
    const map = this.#data.writable();
    if (record) map.set(id, deepFreeze(record));
    else map.delete(id);
  }
}

/**
 * A store over `file`'s records (copied and frozen; the file itself is not changed).
 *
 * @public
 */
export function createStore(file: DocumentFile, options?: StoreOptions): Store {
  return new RecordStore(file, options);
}
