// The autosave journal's pure part (FR-FIL-007, NFR-REL-001, ADR-0024): what one committed change is as a stored entry, how a base set of records plus
// the entries after it rebuild the records a crash left behind, and when the journal is long enough to fold into a checkpoint. No storage here: the
// studio's adapter puts the entries in IndexedDB; the CLI can read an exported journal the same way. An entry holds the whole record after the change
// (added and changed alike) and the ids removed, so replaying is a put and a delete in order and needs nothing from before.
import type { AnyRecord } from '@fluxion/schema';
import { canonicalJson } from './canonical-json.js';

/**
 * One record written by a change.
 *
 * @public
 */
export type JournalPut = {
  /** The record's id. */
  readonly id: string;
  /** The whole record after the change. */
  readonly after: AnyRecord;
};

/**
 * One committed change, as the journal keeps it.
 *
 * @public
 */
export type JournalEntry = {
  /** Its place in the journal: 1, 2, 3 ... with no gap. */
  readonly seq: number;
  /** The store's revision after the change. */
  readonly rev: number;
  /** When it was committed, ISO 8601 (the caller's clock). */
  readonly at: string;
  /** The records written, by id. */
  readonly puts: readonly JournalPut[];
  /** The ids of the records removed. */
  readonly deletes: readonly string[];
};

/**
 * A record a store diff created or changed.
 *
 * @public
 */
export type DiffPut = {
  /** The record after the change. */
  readonly after: AnyRecord;
};

/**
 * The part of a store diff the journal needs (the store's `Diff` fits).
 *
 * @public
 */
export type DiffLike = {
  /** The records created or changed, with their value after the change. */
  readonly puts: ReadonlyMap<string, DiffPut>;
  /** The records deleted. */
  readonly deletes: ReadonlyMap<string, unknown>;
};

/**
 * The journal grows to this many entries before the next write folds it into a checkpoint.
 *
 * @public
 */
export const JOURNAL_MAX_ENTRIES = 200;
/**
 * The journal grows to this many bytes (of entry text) before the next write folds it into a checkpoint.
 *
 * @public
 */
export const JOURNAL_MAX_BYTES: number = 2 * 1024 * 1024;

/**
 * The entry for `diff`, stamped. Puts and deletes are in id order, so the same change is the same entry whatever order the store produced it in.
 *
 * @public
 */
export function encodeDiff(diff: DiffLike, stamp: { readonly seq: number; readonly rev: number; readonly at: string }): JournalEntry {
  const puts = [...diff.puts].map(([id, change]) => ({ id, after: change.after })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const deletes = [...diff.deletes.keys()].sort();
  return { seq: stamp.seq, rev: stamp.rev, at: stamp.at, puts, deletes };
}

/**
 * The entry as canonical JSON text (what is stored).
 *
 * @public
 */
export const serializeEntry = (entry: JournalEntry): string => canonicalJson(entry);

type Json = { readonly [key: string]: unknown };
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
/** The field `key` of `o` (a call, so neither the type checker's index-signature rule nor the linter's literal-key rule applies). */
const field = (o: Json, key: string): unknown => o[key];

/** The puts in `raw`, or undefined when any is not `{ id, after }` with a record whose id is `id`. */
function readPuts(raw: unknown): JournalPut[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: JournalPut[] = [];
  for (const item of raw) {
    const id = isObject(item) ? field(item, 'id') : undefined;
    const after = isObject(item) ? field(item, 'after') : undefined;
    if (typeof id !== 'string' || !isObject(after) || field(after, 'id') !== id || typeof field(after, 'type') !== 'string') return undefined;
    out.push({ id, after: after as AnyRecord });
  }
  return out;
}

/**
 * An entry that was read.
 *
 * @public
 */
export type EntryRead = {
  /** The entry was read. */
  readonly ok: true;
  /** The entry. */
  readonly value: JournalEntry;
};

/**
 * Text that is not an entry.
 *
 * @public
 */
export type EntryRefused = {
  /** The text is not an entry. */
  readonly ok: false;
  /** Why, in a line. */
  readonly reason: string;
};

/**
 * The entry in `text`, or why it is not one (a torn write, a newer shape). Nothing in it is trusted: shapes are checked, not cast.
 *
 * @public
 */
export function readEntry(text: string): EntryRead | EntryRefused {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'the entry is not JSON' };
  }
  if (!isObject(raw)) return { ok: false, reason: 'the entry is not an object' };
  const [seq, rev, at, deletes] = ['seq', 'rev', 'at', 'deletes'].map((key) => field(raw, key));
  const puts = readPuts(field(raw, 'puts'));
  if (!Number.isInteger(seq) || !Number.isInteger(rev) || typeof at !== 'string') return { ok: false, reason: 'the entry has no sequence, revision or time' };
  if (puts === undefined) return { ok: false, reason: 'the entry has a record that is not a record' };
  if (!Array.isArray(deletes) || !deletes.every((d) => typeof d === 'string')) return { ok: false, reason: 'the entry has a deletion that is not an id' };
  // a net change names each record once: a record written and removed, or listed twice, has no one meaning
  const named = [...puts.map((p) => p.id), ...(deletes as string[])];
  if (new Set(named).size !== named.length) return { ok: false, reason: 'the entry names a record twice' };
  return { ok: true, value: { seq: seq as number, rev: rev as number, at, puts, deletes: deletes as string[] } };
}

/**
 * A place in the journal: the last entry's sequence number and revision.
 *
 * @public
 */
export type ReplayPoint = {
  /** The sequence number. */
  readonly seq: number;
  /** The store's revision after it. */
  readonly rev: number;
};

/**
 * Where a replay stopped.
 *
 * @public
 */
export type ReplayStop = {
  /** The sequence number of the entry that could not follow. */
  readonly seq: number;
  /** Why, in a line. */
  readonly reason: string;
  /** How many entries, that one included, were dropped. */
  readonly dropped: number;
};

/**
 * What replaying the journal rebuilt.
 *
 * @public
 */
export type Replayed = {
  /** The records after the last entry that applied. */
  readonly records: { readonly [id: string]: AnyRecord };
  /** How many entries applied. */
  readonly applied: number;
  /** How many entries were skipped because the base already holds their sequence number (a write retried after a crash; more than that is worth telling the person). */
  readonly skipped: number;
  /** The `seq` and `rev` of the last entry that applied (the base's own `seq` and `rev` when none did). */
  readonly last: ReplayPoint;
  /** Present when an entry could not be applied: replay stopped there and the entries from it on were dropped. */
  readonly stopped?: ReplayStop;
};

/**
 * `base` (the records at `{ seq, rev }`, a checkpoint or the file) with `entries` applied in order. The entries must follow one another from
 * `base.seq + 1` with no gap and no repeat; the first that does not, or that is not an entry, stops the replay: what applied before it is kept
 * (the work up to the tear), and the result says where it stopped and how many entries were dropped. A repeated entry (a write retried after a
 * crash) is skipped, not applied twice, and counted in `skipped`.
 *
 * @public
 */
export function replay(
  base: { readonly records: { readonly [id: string]: AnyRecord }; readonly seq: number; readonly rev: number },
  entries: readonly JournalEntry[],
): Replayed {
  // no prototype: a record whose id is `__proto__` is an ordinary key here, not a way to change what every lookup inherits
  const records: { [id: string]: AnyRecord } = Object.assign(Object.create(null) as { [id: string]: AnyRecord }, base.records);
  let last = { seq: base.seq, rev: base.rev };
  let applied = 0;
  let skipped = 0;
  for (const [i, entry] of entries.entries()) {
    if (entry.seq <= last.seq) {
      skipped += 1;
      continue;
    }
    if (entry.seq !== last.seq + 1)
      return { records, applied, skipped, last, stopped: { seq: entry.seq, reason: `entry ${last.seq + 1} is missing`, dropped: entries.length - i } };
    for (const put of entry.puts) records[put.id] = put.after;
    for (const id of entry.deletes) delete records[id];
    last = { seq: entry.seq, rev: entry.rev };
    applied += 1;
  }
  return { records, applied, skipped, last };
}

/**
 * Whether the journal is long enough that the next write should fold it into a checkpoint: 200 entries or 2 MB of entry text.
 *
 * @public
 */
export const needsCompaction = (journal: { readonly entries: number; readonly bytes: number }): boolean =>
  journal.entries >= JOURNAL_MAX_ENTRIES || journal.bytes >= JOURNAL_MAX_BYTES;
