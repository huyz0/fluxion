import { JOURNAL_MAX_ENTRIES } from '@fluxion/format';
import type { AnyRecord, RecordId } from '@fluxion/schema';
import { afterEach, describe, expect, it } from 'vitest';
import { AUTOSAVE_DEBOUNCE_MS, createAutosave, recover, type Timers } from './autosave.js';
import { idbAutosaveStore } from './idb-store.js';
import type { DocMeta } from './store.js';

const id = (s: string) => s as RecordId;
const record = (name: string, n = 0): AnyRecord => ({ id: id(name), type: 'element', kind: 'shape', n }) as AnyRecord;
const meta = (docId: string, headRev: number, savedRev = 0, checkpointSeq = 0): DocMeta => ({
  docId,
  title: `Doc ${docId}`,
  savedRev,
  headRev,
  updated: `t${headRev}`,
  checkpointSeq,
});
const entry = (seq: number) => ({ seq, text: `{"seq":${seq}}` });

const opened: { close(): void }[] = [];
let counter = 0;
/** A store on a database of its own, so tests do not see one another's data. */
async function fresh() {
  counter += 1;
  const name = `fluxion-autosave-test-${Date.now()}-${counter}`;
  const store = await idbAutosaveStore(indexedDB, name);
  opened.push(store);
  return { store, name };
}
afterEach(() => {
  for (const s of opened.splice(0)) s.close();
});

describe('the IndexedDB autosave store (FR-FIL-007, ADR-0024)', () => {
  it('FR-FIL-007: entries and the document record written in one commit are read back, in order, from a second connection', async () => {
    const { store, name } = await fresh();
    await store.commit('d1', { entries: [entry(1), entry(2)], meta: meta('d1', 2), fold: { seq: 0, rev: 0, records: { a: record('a') } } });
    await store.commit('d1', { entries: [entry(3)], meta: meta('d1', 3) });
    const again = await idbAutosaveStore(indexedDB, name);
    opened.push(again);
    const stored = await again.load('d1');
    expect(stored?.meta).toMatchObject({ docId: 'd1', headRev: 3, title: 'Doc d1' });
    expect(stored?.checkpoint).toMatchObject({ seq: 0, rev: 0 });
    expect(Object.keys(stored?.checkpoint?.records ?? {})).toEqual(['a']);
    expect(stored?.entries.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(await again.load('nothing')).toBeUndefined();
  });

  it('FR-FIL-007: a fold replaces the checkpoint and drops the entries it covers, and only those, in the same commit', async () => {
    const { store } = await fresh();
    await store.commit('d1', { entries: [entry(1), entry(2), entry(3)], meta: meta('d1', 3), fold: { seq: 0, rev: 0, records: {} } });
    await store.commit('d1', { entries: [entry(4), entry(5)], meta: meta('d1', 5, 0, 4), fold: { seq: 4, rev: 4, records: { folded: record('folded', 4) } } });
    const stored = await store.load('d1');
    expect(stored?.checkpoint?.seq).toBe(4);
    expect(Object.keys(stored?.checkpoint?.records ?? {})).toEqual(['folded']);
    expect(stored?.entries.map((e) => e.seq)).toEqual([5]);
    expect(stored?.meta.checkpointSeq).toBe(4);
    // another document's journal is not touched by the fold
    await store.commit('d2', { entries: [entry(1)], meta: meta('d2', 1) });
    await store.commit('d1', { entries: [entry(6)], meta: meta('d1', 6, 0, 6), fold: { seq: 6, rev: 6, records: {} } });
    expect((await store.load('d2'))?.entries).toHaveLength(1);
    expect((await store.load('d1'))?.entries).toHaveLength(0);
  });

  it('NFR-REL-001: a commit that fails part way writes nothing: no entry, no record, no checkpoint', async () => {
    const { store } = await fresh();
    await store.commit('d1', { entries: [entry(1)], meta: meta('d1', 1), fold: { seq: 0, rev: 0, records: { a: record('a') } } });
    // a function in a record cannot be stored (DataCloneError): the transaction has already put the entries by then
    const bad = { seq: 2, rev: 2, records: { x: { id: 'x', type: 'element', f: () => 1 } as unknown as AnyRecord } };
    await expect(store.commit('d1', { entries: [entry(2)], meta: meta('d1', 2), fold: bad })).rejects.toBeDefined();
    const stored = await store.load('d1');
    expect(stored?.entries.map((e) => e.seq)).toEqual([1]);
    expect(stored?.meta.headRev).toBe(1);
    expect(stored?.checkpoint?.seq).toBe(0);
  });

  it('FR-FIL-009: truncateAfter drops the torn tail first, in the same commit as the entries that follow the last good one', async () => {
    const { store } = await fresh();
    await store.commit('d1', { entries: [entry(1), entry(2), entry(3)], meta: meta('d1', 3), fold: { seq: 0, rev: 0, records: {} } });
    await store.commit('d1', { entries: [{ seq: 2, text: '{"seq":2,"again":true}' }], meta: meta('d1', 2), truncateAfter: 1 });
    const stored = await store.load('d1');
    expect(stored?.entries.map((e) => [e.seq, e.text])).toEqual([
      [1, '{"seq":1}'],
      [2, '{"seq":2,"again":true}'],
    ]);
  });

  it('FR-FIL-007: unsaved lists documents with work the file lacks, newest first; setSaved clears one; discard forgets it', async () => {
    const { store } = await fresh();
    await store.commit('old', { entries: [entry(1)], meta: { ...meta('old', 1), updated: '2026-01-01' } });
    await store.commit('new', { entries: [entry(1)], meta: { ...meta('new', 1), updated: '2026-02-01' } });
    await store.commit('clean', { entries: [entry(1)], meta: meta('clean', 1, 1) });
    expect((await store.unsaved()).map((m) => m.docId)).toEqual(['new', 'old']);
    await store.setSaved('old', 1);
    expect((await store.unsaved()).map((m) => m.docId)).toEqual(['new']);
    await store.discard('new');
    expect(await store.load('new')).toBeUndefined();
    expect(await store.unsaved()).toEqual([]);
    // setSaved on a document that is not there changes nothing and does not throw
    await store.setSaved('ghost', 5);
    expect(await store.load('ghost')).toBeUndefined();
  });

  it('FR-FIL-007: the scheduler on the real store: edits, a fold at 200 entries, and a recovery from a second connection equal the records', async () => {
    const { store, name } = await fresh();
    let now = 0;
    const pending: { at: number; fn: () => void }[] = [];
    const timers: Timers = {
      now: () => now,
      setTimeout: (fn, ms) => {
        const t = { at: now + ms, fn };
        pending.push(t);
        return t;
      },
      clearTimeout: (h) => void pending.splice(pending.indexOf(h as (typeof pending)[number]), 1),
    };
    let records: { [k: string]: AnyRecord } = { base: record('base') };
    const autosave = createAutosave({
      docId: 'live',
      store,
      timers,
      iso: () => `t${now}`,
      records: () => records,
      title: () => 'Live',
      base: { records, rev: 0, seq: 0 },
    });
    const edit = (name2: string, n: number, rev: number) => {
      records = { ...records, [name2]: record(name2, n) };
      autosave.change({ puts: new Map([[name2, { after: record(name2, n) }]]), deletes: new Map() }, rev);
    };
    // a first write of 150 entries, which also stores the document as opened; the next 55 take the journal past 200 and fold it
    for (let i = 1; i <= 150; i++) edit(`r${i % 11}`, i, i);
    await autosave.flush();
    for (let i = 151; i <= JOURNAL_MAX_ENTRIES + 5; i++) edit(`r${i % 11}`, i, i);
    now += AUTOSAVE_DEBOUNCE_MS;
    await autosave.flush();
    const other = await idbAutosaveStore(indexedDB, name);
    opened.push(other);
    const stored = await other.load('live');
    expect(stored?.checkpoint).toMatchObject({ seq: JOURNAL_MAX_ENTRIES + 5, rev: JOURNAL_MAX_ENTRIES + 5 });
    expect(stored?.entries).toHaveLength(0);
    const got = recover(stored as NonNullable<typeof stored>);
    expect(got?.records).toEqual(records);
    expect(got).toMatchObject({ unsaved: true, rev: JOURNAL_MAX_ENTRIES + 5 });
    autosave.dispose();
  });

  it('FR-FIL-007: when another tab upgrades the database this one lets go, and its next write opens the database again with nothing lost', async () => {
    const { store, name } = await fresh();
    await store.commit('d1', { entries: [entry(1)], meta: meta('d1', 1), fold: { seq: 0, rev: 0, records: { a: record('a') } } });
    // another tab ships a newer version of the schema: it can only open once this connection has let go
    const upgraded = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 2);
      request.onupgradeneeded = () => request.result.createObjectStore('later', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    upgraded.close();
    await store.commit('d1', { entries: [entry(2)], meta: meta('d1', 2) });
    const stored = await store.load('d1');
    expect(stored?.entries.map((e) => e.seq)).toEqual([1, 2]);
    expect(stored?.meta.headRev).toBe(2);
    expect((await store.unsaved()).map((m) => m.docId)).toEqual(['d1']);
  });

  it('FR-FIL-007: a store that was closed refuses further work instead of opening the database again', async () => {
    const { store } = await fresh();
    store.close();
    await expect(store.load('d1')).rejects.toMatchObject({ name: 'InvalidStateError' });
  });

  it('FR-FIL-007: an open that is blocked rejects, and the connection that arrives after it is closed', async () => {
    let closed = 0;
    const request: { onblocked?: () => void; onsuccess?: () => void; onerror?: () => void; onupgradeneeded?: () => void; result?: unknown; error?: unknown } =
      {};
    const factory = { open: () => request } as unknown as IDBFactory;
    const pending = idbAutosaveStore(factory, 'blocked');
    request.onblocked?.();
    await expect(pending).rejects.toMatchObject({ name: 'InvalidStateError' });
    request.result = { close: () => (closed += 1) };
    request.onsuccess?.();
    expect(closed).toBe(1);
  });
});
