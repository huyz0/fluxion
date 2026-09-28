// Copy-on-write record storage (ADR-0014 §Forks): a store and its forks share one map until one of
// them writes; the writer copies first, so no store ever writes into a map another store reads.
import type { AnyRecord, RecordId } from '@fluxion/schema';

type Box = { map: Map<RecordId, AnyRecord>; sharers: number };

/** One store's handle on a record map that other handles may share. */
export class SharedRecordMap {
  #box: Box;

  constructor(map: Map<RecordId, AnyRecord> = new Map(), box?: Box) {
    this.#box = box ?? { map, sharers: 1 };
  }

  /** The records, read-only (shared maps must not be written through this). */
  get map(): ReadonlyMap<RecordId, AnyRecord> {
    return this.#box.map;
  }

  /** Another handle on the same map (O(1)); the map is copied by whichever handle writes first. */
  share(): SharedRecordMap {
    this.#box.sharers++;
    return new SharedRecordMap(undefined, this.#box);
  }

  /** The map for writing: this handle's own copy when others share it. */
  writable(): Map<RecordId, AnyRecord> {
    if (this.#box.sharers > 1) {
      this.#box.sharers--;
      this.#box = { map: new Map(this.#box.map), sharers: 1 };
    }
    return this.#box.map;
  }
}
