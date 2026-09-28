// Incremental indexes (03-core-engine §1): maintained from each applied change, never rebuilt, so
// queries cost O(changed) (NFR-MNT-006). Each index key has a version signal: a query that read a
// key re-runs only when that key's members change.
import type { AnyRecord, RecordId } from '@fluxion/schema';
import { type WritableSignal, writable } from './signals.js';

/**
 * The indexes a store keeps.
 *
 * @public
 */
export type IndexName = 'byScreen' | 'byParent' | 'byType' | 'bindingsByElement';

const NAMES: readonly IndexName[] = ['byScreen', 'byParent', 'byType', 'bindingsByElement'];

/** The keys `record` is filed under in each index. */
export function keysOf(record: AnyRecord): Array<[IndexName, string]> {
  const r = record as {
    readonly type: string;
    readonly screenId?: unknown;
    readonly parentId?: unknown;
    readonly elementId?: unknown;
    readonly connectorId?: unknown;
  };
  const out: Array<[IndexName, string]> = [['byType', r.type]];
  if (r.type === 'element' && typeof r.screenId === 'string') out.push(['byScreen', r.screenId]);
  if (r.type === 'element' && typeof r.parentId === 'string') out.push(['byParent', r.parentId]);
  // a binding belongs to both ends: the bound element and the connector (itself an element; M3.12 review F2)
  if (r.type === 'binding' && typeof r.elementId === 'string') out.push(['bindingsByElement', r.elementId]);
  if (r.type === 'binding' && typeof r.connectorId === 'string' && r.connectorId !== r.elementId) out.push(['bindingsByElement', r.connectorId]);
  return out;
}

/** The four indexes: key → member ids, with a version signal per key. */
export class Indexes {
  readonly #maps = new Map<IndexName, Map<string, Set<RecordId>>>(NAMES.map((n) => [n, new Map()]));
  readonly #versions = new Map<string, WritableSignal<number>>();
  // version numbers kept outside the signals: a bump must write, never read, a signal (a tracked
  // read would subscribe whatever effect is running the transaction; M3.12 review F1). Only keys
  // that have a signal (someone read them) have a count (M3.12 review r2 F2).
  readonly #counts = new Map<string, number>();

  constructor(records: Iterable<AnyRecord>) {
    // no key has a version signal yet, so nothing is bumped
    for (const record of records) for (const [n, k] of keysOf(record)) this.#insert(n, k, record.id as RecordId);
  }

  /** Members of `key` in `index` (a snapshot); reading inside a signal context subscribes to the key. */
  members(index: IndexName, key: string): RecordId[] {
    this.#version(index, key).get();
    return [...(this.#maps.get(index)?.get(key) ?? [])];
  }

  /** Move `before` (if any) out of and `after` (if any) into the indexes; bump the keys that changed. */
  update(before: AnyRecord | undefined, after: AnyRecord | undefined): void {
    const was = before ? keysOf(before) : [];
    const now = after ? keysOf(after) : [];
    const has = (list: Array<[IndexName, string]>, [n, k]: [IndexName, string]) => list.some(([m, j]) => m === n && j === k);
    for (const key of was.filter((key) => !has(now, key))) this.#remove(key[0], key[1], before?.id as RecordId);
    for (const key of now.filter((key) => !has(was, key))) {
      this.#insert(key[0], key[1], after?.id as RecordId);
      this.#bump(key[0], key[1]);
    }
  }

  /** Members of `key` in `index` without subscribing (for code running inside a transaction). */
  peek(index: IndexName, key: string): RecordId[] {
    return [...(this.#maps.get(index)?.get(key) ?? [])];
  }

  /** Every index as sorted plain data (tests compare incremental and rebuilt indexes with it). */
  snapshot(): Record<IndexName, Record<string, RecordId[]>> {
    const out = {} as Record<IndexName, Record<string, RecordId[]>>;
    for (const [name, map] of this.#maps) {
      // #remove drops a key with its last member, so every key here has members
      const keys = [...map.keys()].sort();
      out[name] = Object.fromEntries(keys.map((k) => [k, [...(map.get(k) ?? [])].sort()]));
    }
    return out;
  }

  #insert(index: IndexName, key: string, id: RecordId): void {
    const map = this.#maps.get(index);
    if (!map) return;
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    set.add(id);
  }

  #remove(index: IndexName, key: string, id: RecordId): void {
    const set = this.#maps.get(index)?.get(key);
    if (!set?.delete(id)) return;
    if (set.size === 0) this.#maps.get(index)?.delete(key);
    this.#bump(index, key);
  }

  #version(index: IndexName, key: string): WritableSignal<number> {
    const id = `${index} ${key}`;
    let v = this.#versions.get(id);
    if (!v) {
      v = writable(0);
      this.#versions.set(id, v);
    }
    return v;
  }

  #bump(index: IndexName, key: string): void {
    const id = `${index} ${key}`;
    const v = this.#versions.get(id);
    if (!v) return;
    // tzap disable next-line ArithmeticOperator: counting down gives distinct values too; the signal only needs a value unlike its last
    const next = (this.#counts.get(id) ?? 0) + 1;
    this.#counts.set(id, next);
    v.set(next);
  }
}
