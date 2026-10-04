import { JOURNAL_MAX_ENTRIES } from '@fluxion/format';
import type { AnyRecord, RecordId } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { AUTOSAVE_DEBOUNCE_MS, AUTOSAVE_MAX_WAIT_MS, type AutosaveOptions, type AutosaveStatus, createAutosave, recover, type Timers } from './autosave.js';
import { memoryAutosaveStore } from './store.js';

const id = (s: string) => s as RecordId;
const record = (name: string, n = 0): AnyRecord => ({ id: id(name), type: 'element', kind: 'shape', n }) as AnyRecord;
const diff = (name: string, n: number) => ({ puts: new Map([[name, { after: record(name, n) }]]), deletes: new Map<string, unknown>() });
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A clock that only moves when told to, and runs the timers that fall due as it passes them. */
function fakeTimers() {
  let now = 0;
  let next = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const api: Timers = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const handle = next++;
      timers.set(handle, { at: now + ms, fn });
      return handle;
    },
    clearTimeout: (handle) => void timers.delete(handle as number),
  };
  return {
    api,
    now: () => now,
    pending: () => timers.size,
    async advance(ms: number) {
      const target = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (due === undefined) break;
        timers.delete(due[0]);
        now = Math.max(now, due[1].at);
        due[1].fn();
        await settle();
      }
      now = target;
    },
  };
}

function setup(extra: Partial<Omit<AutosaveOptions, 'base'>> & { base?: AutosaveOptions['base'] | null } = {}) {
  const clock = fakeTimers();
  const store = memoryAutosaveStore();
  let records: { [k: string]: AnyRecord } = { base: record('base') };
  const autosave = createAutosave({
    docId: 'doc1',
    store,
    timers: clock.api,
    iso: () => `t${clock.now()}`,
    records: () => records,
    title: () => 'A deck',
    ...(extra.base === null ? {} : { base: { records: { base: record('base') }, rev: 0, seq: 0 } }),
    ...(extra.stored === undefined ? {} : { stored: extra.stored }),
    ...(extra.store === undefined ? {} : { store: extra.store }),
    ...(extra.title === undefined ? {} : { title: extra.title }),
  });
  const statuses: AutosaveStatus[] = [];
  autosave.onStatus((s) => statuses.push(s));
  /** Commit a change as the editor would: the records change, then the journal hears of it. */
  const edit = (name: string, n: number, rev: number) => {
    records = { ...records, [name]: record(name, n) };
    autosave.change(diff(name, n), rev);
  };
  return { clock, store, autosave, statuses, edit, records: () => records };
}

describe('when autosave writes', () => {
  it('FR-FIL-007: a change is written after the debounce, and not before', async () => {
    const { clock, store, edit, autosave } = setup();
    edit('a', 1, 1);
    expect(autosave.status().kind).toBe('pending');
    await clock.advance(AUTOSAVE_DEBOUNCE_MS - 1);
    expect(store.commits()).toBe(0);
    await clock.advance(1);
    expect(store.commits()).toBe(1);
    expect(autosave.status().kind).toBe('saved');
    const stored = await store.load('doc1');
    expect(stored?.entries.map((e) => e.seq)).toEqual([1]);
    expect(stored?.meta).toMatchObject({ docId: 'doc1', title: 'A deck', savedRev: 0, headRev: 1, checkpointSeq: 0 });
  });

  it('NFR-REL-001: editing that never pauses is still written within the 5 s budget', async () => {
    const { clock, store, edit } = setup();
    let writtenAt: number | undefined;
    // a change every 500 ms, so the debounce never gets its quiet time
    for (let i = 1; i <= 12; i++) {
      edit('a', i, i);
      await clock.advance(500);
      if (writtenAt === undefined && store.commits() > 0) writtenAt = clock.now();
    }
    expect(AUTOSAVE_MAX_WAIT_MS).toBeLessThan(5000);
    expect(writtenAt).toBeDefined();
    // the first change was at 0: its write is at the cap, inside the budget
    expect(writtenAt as number).toBeLessThanOrEqual(5000);
    expect(writtenAt as number).toBeGreaterThanOrEqual(AUTOSAVE_MAX_WAIT_MS);
  });

  it('FR-FIL-007: flush writes at once (the page is being hidden), and a flush with nothing waiting writes nothing', async () => {
    const { clock, store, edit, autosave } = setup();
    edit('a', 1, 1);
    await autosave.flush();
    expect(store.commits()).toBe(1);
    expect(clock.pending()).toBe(0);
    await autosave.flush();
    expect(store.commits()).toBe(1);
  });

  it('FR-FIL-007: the first write carries the document as opened, so a recovery never needs the file', async () => {
    const { clock, store, edit } = setup();
    edit('a', 1, 1);
    edit('b', 1, 2);
    await clock.advance(AUTOSAVE_DEBOUNCE_MS);
    const stored = await store.load('doc1');
    expect(stored?.checkpoint).toMatchObject({ seq: 0, rev: 0 });
    expect(Object.keys(stored?.checkpoint?.records ?? {})).toEqual(['base']);
    expect(stored?.entries).toHaveLength(2);
    const got = recover(stored as NonNullable<typeof stored>);
    expect(Object.keys(got?.records ?? {}).sort()).toEqual(['a', 'b', 'base']);
    expect(got).toMatchObject({ rev: 2, unsaved: true, applied: 2, title: 'A deck' });
    // later writes do not store the base again
    edit('c', 1, 3);
    await clock.advance(AUTOSAVE_DEBOUNCE_MS);
    expect((await store.load('doc1'))?.checkpoint?.seq).toBe(0);
  });

  it('FR-FIL-007: changes made while a write is really in flight are not lost: they are written next, once, in order', async () => {
    const { clock, store, edit, autosave } = setup();
    edit('a', 1, 1);
    const hold = store.holdNext();
    await clock.advance(AUTOSAVE_DEBOUNCE_MS);
    // the first write has taken its batch and waits in the store; the person goes on editing
    edit('b', 1, 2);
    edit('c', 1, 3);
    expect(store.commits()).toBe(0);
    hold.release();
    await settle();
    expect((await store.load('doc1'))?.entries.map((e) => e.seq)).toEqual([1]);
    expect(autosave.status().kind).toBe('pending');
    await clock.advance(AUTOSAVE_DEBOUNCE_MS);
    expect((await store.load('doc1'))?.entries.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(autosave.status().kind).toBe('saved');
    expect(store.commits()).toBe(2);
  });

  it('FR-FIL-007: a flush during a write waits for it and then writes what arrived meanwhile', async () => {
    const { clock, store, edit, autosave } = setup();
    edit('a', 1, 1);
    const hold = store.holdNext();
    await clock.advance(AUTOSAVE_DEBOUNCE_MS);
    edit('b', 1, 2);
    const flushed = autosave.flush();
    hold.release();
    await flushed;
    expect((await store.load('doc1'))?.entries.map((e) => e.seq)).toEqual([1, 2]);
    expect(autosave.status().kind).toBe('saved');
  });
});

describe('a long journal', () => {
  it('FR-FIL-007: at 200 entries the next write folds the journal into a checkpoint and the recovery is the same', async () => {
    const { clock, store, edit, autosave, records } = setup();
    for (let i = 1; i <= JOURNAL_MAX_ENTRIES - 1; i++) edit(`r${i % 7}`, i, i);
    await autosave.flush();
    expect((await store.load('doc1'))?.entries).toHaveLength(JOURNAL_MAX_ENTRIES - 1);
    // the 200th entry is the one that crosses the limit: its write folds
    edit('r1', 999, JOURNAL_MAX_ENTRIES);
    await clock.advance(AUTOSAVE_DEBOUNCE_MS);
    const stored = await store.load('doc1');
    expect(stored?.entries).toHaveLength(0);
    expect(stored?.checkpoint).toMatchObject({ seq: JOURNAL_MAX_ENTRIES, rev: JOURNAL_MAX_ENTRIES });
    expect(stored?.meta.checkpointSeq).toBe(JOURNAL_MAX_ENTRIES);
    expect(recover(stored as NonNullable<typeof stored>)?.records).toEqual(records());
    // the journal grows again from there
    edit('z', 1, JOURNAL_MAX_ENTRIES + 1);
    await clock.advance(AUTOSAVE_DEBOUNCE_MS);
    expect((await store.load('doc1'))?.entries.map((e) => e.seq)).toEqual([JOURNAL_MAX_ENTRIES + 1]);
  });
});

describe('a fold that fails', () => {
  it('FR-FIL-007: when the write that folds the journal fails, nothing is lost: the retry folds it, and the recovery equals the records', async () => {
    const { clock, store, edit, autosave, records } = setup();
    for (let i = 1; i <= 150; i++) edit(`r${i % 7}`, i, i);
    await autosave.flush();
    for (let i = 151; i <= JOURNAL_MAX_ENTRIES + 5; i++) edit(`r${i % 7}`, i, i);
    store.failNext(1, new Error('storage is busy'));
    await clock.advance(AUTOSAVE_DEBOUNCE_MS);
    expect(autosave.status()).toMatchObject({ kind: 'failed', retryInMs: 1000 });
    // the journal on disk is what it was before the failed write
    expect((await store.load('doc1'))?.entries).toHaveLength(150);
    await clock.advance(1000);
    expect(autosave.status().kind).toBe('saved');
    const stored = await store.load('doc1');
    expect(stored?.entries).toHaveLength(0);
    expect(stored?.checkpoint?.seq).toBe(JOURNAL_MAX_ENTRIES + 5);
    expect(recover(stored as NonNullable<typeof stored>)?.records).toEqual(records());
  });

  it('FR-FIL-007: a function the scheduler calls failing (the records, the title) is a failed write that is tried again, not the end of autosave', async () => {
    let broken = true;
    const { clock, store, edit, autosave } = setup({
      title: () => {
        if (broken) throw new Error('the document is closing');
        return 'A deck';
      },
    });
    edit('a', 1, 1);
    await clock.advance(AUTOSAVE_DEBOUNCE_MS);
    expect(autosave.status()).toMatchObject({ kind: 'failed', message: 'the document is closing', retryInMs: 1000 });
    broken = false;
    await clock.advance(1000);
    expect(autosave.status().kind).toBe('saved');
    expect((await store.load('doc1'))?.entries.map((e) => e.seq)).toEqual([1]);
    // a later flush still works
    edit('b', 1, 2);
    await autosave.flush();
    expect((await store.load('doc1'))?.entries.map((e) => e.seq)).toEqual([1, 2]);
  });
});

describe('when storage fails', () => {
  it('FR-FIL-007: a failed write is a status that stays, the changes are kept, and the write is tried again 1, 2, 4 s later, then every 30 s', async () => {
    const { clock, store, edit, autosave, statuses } = setup();
    store.failNext(4, new DOMException('the disk is full', 'QuotaExceededError'));
    edit('a', 1, 1);
    await clock.advance(AUTOSAVE_DEBOUNCE_MS);
    expect(autosave.status()).toEqual({ kind: 'failed', message: 'QuotaExceededError: the disk is full', retryInMs: 1000 });
    // a change while failing waits with the others; it does not hide the status
    edit('b', 1, 2);
    expect(autosave.status().kind).toBe('failed');
    await clock.advance(1000);
    expect(autosave.status()).toMatchObject({ kind: 'failed', retryInMs: 2000 });
    await clock.advance(2000);
    expect(autosave.status()).toMatchObject({ kind: 'failed', retryInMs: 4000 });
    await clock.advance(4000);
    expect(autosave.status()).toMatchObject({ kind: 'failed', retryInMs: 30_000 });
    expect(store.commits()).toBe(0);
    // the fourth failure was the last: the next try succeeds with both changes, once, in order
    await clock.advance(30_000);
    expect(autosave.status().kind).toBe('saved');
    expect((await store.load('doc1'))?.entries.map((e) => e.seq)).toEqual([1, 2]);
    expect(statuses.map((s) => s.kind)).toContain('failed');
    expect(statuses.at(-1)).toEqual({ kind: 'saved' });
  });

  it('FR-FIL-007: the base the first entries build on is not lost when the first write fails', async () => {
    const { clock, store, edit } = setup();
    store.failNext(1, new Error('private window'));
    edit('a', 1, 1);
    await clock.advance(AUTOSAVE_DEBOUNCE_MS + 1000);
    const stored = await store.load('doc1');
    expect(stored?.checkpoint).toMatchObject({ seq: 0 });
    expect(stored?.entries.map((e) => e.seq)).toEqual([1]);
  });
});

describe('explicit save and recovery', () => {
  it('FR-FIL-007: saving the file marks the journal as saved, so there is nothing to recover', async () => {
    const { store, edit, autosave } = setup();
    edit('a', 1, 1);
    await autosave.saved(1);
    const stored = await store.load('doc1');
    expect(stored?.meta.savedRev).toBe(1);
    expect(recover(stored as NonNullable<typeof stored>)?.unsaved).toBe(false);
    expect(await store.unsaved()).toEqual([]);
    edit('b', 1, 2);
    await autosave.flush();
    expect((await store.unsaved()).map((m) => m.docId)).toEqual(['doc1']);
  });

  it('FR-FIL-009: a torn entry recovers up to the work before it and says what was dropped; no checkpoint recovers nothing', async () => {
    const { store, edit, autosave } = setup();
    edit('a', 1, 1);
    edit('b', 1, 2);
    edit('c', 1, 3);
    await autosave.flush();
    const stored = (await store.load('doc1')) as NonNullable<Awaited<ReturnType<typeof store.load>>>;
    const torn = { ...stored, entries: stored.entries.map((e) => (e.seq === 2 ? { ...e, text: e.text.slice(0, 20) } : e)) };
    const got = recover(torn);
    expect(Object.keys(got?.records ?? {}).sort()).toEqual(['a', 'base']);
    expect(got?.dropped).toMatchObject({ entries: 2 });
    expect(got?.dropped?.reason).toContain('entry 2');
    const { checkpoint: _gone, ...bare } = stored;
    expect(recover(bare)).toBeUndefined();
  });

  it('FR-FIL-007: a document opened with work in the journal goes on from where it stopped', async () => {
    const first = setup();
    first.edit('a', 1, 1);
    await first.autosave.flush();
    const stored = await first.store.load('doc1');
    const second = setup({ store: first.store, ...(stored === undefined ? {} : { stored }), base: null });
    second.edit('b', 1, 2);
    await second.autosave.flush();
    expect((await first.store.load('doc1'))?.entries.map((e) => e.seq)).toEqual([1, 2]);
  });

  it('FR-FIL-009: a torn journal that is reopened and edited on keeps the new work: it follows the last good entry, and the torn tail goes', async () => {
    const first = setup();
    first.edit('a', 1, 1);
    first.edit('b', 1, 2);
    first.edit('c', 1, 3);
    await first.autosave.flush();
    const whole = (await first.store.load('doc1')) as NonNullable<Awaited<ReturnType<typeof first.store.load>>>;
    // entry 2 is torn: 1 is good, 2 and 3 cannot be used
    const torn = { ...whole, entries: whole.entries.map((e) => (e.seq === 2 ? { ...e, text: e.text.slice(0, 15) } : e)) };
    expect(recover(torn)?.dropped).toMatchObject({ entries: 2 });
    const store = memoryAutosaveStore();
    await store.commit('doc1', { entries: torn.entries, meta: torn.meta, ...(torn.checkpoint === undefined ? {} : { fold: torn.checkpoint }) });
    const clock = fakeTimers();
    const resumed = createAutosave({ docId: 'doc1', store, timers: clock.api, iso: () => 'later', records: () => ({}), title: () => 'A deck', stored: torn });
    resumed.change(diff('d', 1), 2);
    await resumed.flush();
    const after = (await store.load('doc1')) as NonNullable<Awaited<ReturnType<typeof store.load>>>;
    // 1 (good), then the new entry numbered 2 in the torn one's place; 3 is gone
    expect(after.entries.map((e) => e.seq)).toEqual([1, 2]);
    const got = recover(after);
    expect(got?.dropped).toBeUndefined();
    expect(Object.keys(got?.records ?? {}).sort()).toEqual(['a', 'base', 'd']);
    // and one more change goes on from there
    resumed.change(diff('e', 1), 3);
    await resumed.flush();
    expect(Object.keys(recover((await store.load('doc1')) as NonNullable<Awaited<ReturnType<typeof store.load>>>)?.records ?? {}).sort()).toEqual([
      'a',
      'base',
      'd',
      'e',
    ]);
  });

  it('FR-FIL-007: dispose stops the timers and the listeners', async () => {
    const { clock, store, edit, autosave } = setup();
    edit('a', 1, 1);
    autosave.dispose();
    expect(clock.pending()).toBe(0);
    await clock.advance(10_000);
    expect(store.commits()).toBe(0);
  });
});
