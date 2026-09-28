import type { AnyRecord, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { effect } from './signals.js';
import { createStore, RecordStore } from './store.js';

function fixture() {
  const b = documentBuilder({ seed: 1 });
  const screen = b.screen();
  const a = b.rect(screen, { x: 0 });
  const c = b.rect(screen, { x: 200 });
  const file = b.build();
  return { file, screen, a, c };
}

/** Count how often an effect reading `read` runs (the first run included). */
function counter(read: () => unknown): { runs: number; stop: () => void } {
  const out = { runs: 0, stop: () => {} };
  out.stop = effect(() => {
    read();
    out.runs++;
  });
  return out;
}

describe('RecordStore (ADR-0002, 03-core-engine §1)', () => {
  it("NFR-MNT-006: WHEN one record changes THE SYSTEM SHALL notify only that record's subscribers", () => {
    const { file, screen, a, c } = fixture();
    const store = new RecordStore(file);
    const onA = counter(store.record$(a));
    const onC = counter(store.record$(c));
    const onScreen = counter(store.record$(screen));
    expect([onA.runs, onC.runs, onScreen.runs]).toEqual([1, 1, 1]);

    const before = store.get(a) as AnyRecord & { name?: string };
    store.apply([{ ...before, name: 'moved' } as AnyRecord], []);
    expect([onA.runs, onC.runs, onScreen.runs]).toEqual([2, 1, 1]);
    expect(store.record$(a)()).toBe(store.get(a));

    store.apply([], [c]);
    expect([onA.runs, onC.runs, onScreen.runs]).toEqual([2, 2, 1]);
    expect(store.record$(c)()).toBeUndefined();
    for (const x of [onA, onC, onScreen]) x.stop();
  });

  it('NFR-MNT-006: several changes applied together notify each changed record once', () => {
    const { file, a, c } = fixture();
    const store = new RecordStore(file);
    let both = 0;
    const stop = effect(() => {
      store.record$(a)();
      store.record$(c)();
      both++;
    });
    const rename = (id: RecordId) => ({ ...(store.get(id) as AnyRecord), name: 'x' }) as AnyRecord;
    store.apply([rename(a), rename(c)], []);
    expect(both).toBe(2);
    stop();
  });

  it('records are deep-frozen copies; the input file is untouched', () => {
    const { file, a } = fixture();
    const store = createStore(file);
    const record = store.get(a) as AnyRecord & { transform: object };
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.transform)).toBe(true);
    expect(Object.isFrozen(file.records[a])).toBe(false);
    expect(store.size).toBe(Object.keys(file.records).length);
    expect(store.ids()).toEqual(Object.keys(file.records));
    expect(store.has(a)).toBe(true);
    expect(store.has('nope' as RecordId)).toBe(false);
  });

  it('toDocument returns the envelope with the current records', () => {
    const { file, c } = fixture();
    const store = new RecordStore(file);
    expect(store.toDocument()).toEqual(file);
    store.apply([], [c]);
    const { [c]: _gone, ...rest } = file.records;
    expect(store.toDocument()).toEqual({ ...file, records: rest });
  });
});
