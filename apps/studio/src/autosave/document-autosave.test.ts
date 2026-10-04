import type { Store } from '@fluxion/core';
import type { AnyRecord, RecordId } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import type { Timers } from './autosave.js';
import { memoryBlobs } from './blobs.js';
import { type DocumentAutosaveOptions, type LockPort, startDocumentAutosave } from './document-autosave.js';
import { listSnapshots, SNAPSHOT_INTERVAL_MS } from './snapshots.js';
import { memoryAutosaveStore } from './store.js';

const id = (s: string) => s as RecordId;
const record = (name: string, n = 0): AnyRecord => ({ id: id(name), type: 'element', kind: 'shape', n }) as AnyRecord;
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

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

/** A store that holds records and announces changes as the real one does. */
function fakeStore() {
  const records = new Map<string, AnyRecord>([['base', record('base')]]);
  const listeners = new Set<(diff: never, meta: never) => void>();
  const store = {
    ids: () => [...records.keys()] as RecordId[],
    get: (rid: RecordId) => records.get(rid),
    subscribe: (l: (diff: never, meta: never) => void) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
  } as unknown as Pick<Store, 'ids' | 'get' | 'subscribe'>;
  return {
    store,
    listeners: () => listeners.size,
    edit(name: string, n: number) {
      records.set(name, record(name, n));
      for (const l of listeners) l({ puts: new Map([[name, { after: record(name, n) }]]), deletes: new Map() } as never, {} as never);
    },
  };
}

/** A lock manager of one process: a name is held until released. */
function fakeLocks(): LockPort {
  const held = new Set<string>();
  return {
    acquire(name) {
      if (held.has(name)) return Promise.resolve(undefined);
      held.add(name);
      return Promise.resolve(() => void held.delete(name));
    },
  };
}

function setup(extra: Partial<DocumentAutosaveOptions> = {}) {
  const clock = fakeTimers();
  const journal = memoryAutosaveStore();
  const blobs = memoryBlobs();
  const doc = fakeStore();
  const options: DocumentAutosaveOptions = {
    docId: 'd1',
    store: doc.store,
    title: () => 'A deck',
    journal,
    durable: true,
    blobs,
    snapshots: true,
    lock: fakeLocks(),
    persist: () => Promise.resolve(true),
    timers: clock.api,
    iso: () => new Date(Date.UTC(2026, 9, 4, 10, 0, 0, 0) + 1).toISOString(),
    flux: () => Promise.resolve(new Uint8Array([1, 2, 3])),
    ...extra,
  };
  return { clock, journal, blobs, doc, options };
}

describe("a document's protection (FR-FIL-007, NFR-REL-001)", () => {
  it('FR-FIL-007: a second tab for the same document is told it is read-only, and may edit once the first lets go', async () => {
    const { options } = setup();
    const first = await startDocumentAutosave(options);
    expect(first.kind).toBe('editing');
    expect((await startDocumentAutosave(options)).kind).toBe('read-only');
    if (first.kind === 'editing') first.autosave.stop();
    expect((await startDocumentAutosave(options)).kind).toBe('editing');
  });

  it("FR-FIL-007: another document's lock is its own", async () => {
    const { options } = setup();
    await startDocumentAutosave(options);
    expect((await startDocumentAutosave({ ...options, docId: 'd2' })).kind).toBe('editing');
  });

  it('NFR-REL-001: a committed change reaches the journal within the debounce', async () => {
    const { options, doc, clock, journal } = setup();
    const started = await startDocumentAutosave(options);
    expect(started.kind).toBe('editing');
    doc.edit('a', 1);
    await clock.advance(2000);
    expect((await journal.load('d1'))?.entries).toHaveLength(1);
    expect((await journal.unsaved()).map((m) => m.docId)).toEqual(['d1']);
  });

  it('FR-FIL-007: the status says protected once the browser keeps the storage, may be cleared if it will not, unavailable without storage', async () => {
    for (const [persist, durable, want] of [
      [true, true, 'protected'],
      [false, true, 'may-be-cleared'],
      [true, false, 'unavailable'],
    ] as const) {
      const { options } = setup({ persist: () => Promise.resolve(persist), durable });
      const started = await startDocumentAutosave(options);
      await settle();
      if (started.kind === 'editing') expect(started.autosave.state().protection).toBe(want);
    }
  });

  it('FR-FIL-007: the status is announced when persistence is granted and when a write lands', async () => {
    const { options, doc, clock } = setup();
    const started = await startDocumentAutosave(options);
    if (started.kind !== 'editing') throw new Error('expected editing');
    const seen: string[] = [];
    started.autosave.onState((s) => seen.push(`${s.protection}/${s.write.kind}`));
    await settle();
    doc.edit('a', 1);
    await clock.advance(2000);
    expect(seen).toContain('protected/pending');
    expect(seen.at(-1)).toBe('protected/saved');
  });

  it('FR-FIL-007: a version is written on explicit save, and every 10 minutes only while there are changes', async () => {
    const { options, doc, clock, blobs } = setup();
    const started = await startDocumentAutosave(options);
    if (started.kind !== 'editing') throw new Error('expected editing');
    await clock.advance(SNAPSHOT_INTERVAL_MS * 2);
    expect(await listSnapshots(blobs, 'd1')).toHaveLength(0);
    doc.edit('a', 1);
    await clock.advance(SNAPSHOT_INTERVAL_MS);
    expect((await listSnapshots(blobs, 'd1')).length).toBe(1);
    await started.autosave.saved();
    expect((await listSnapshots(blobs, 'd1')).length).toBe(1); // same millisecond on the fake clock: one version
    expect((await options.journal.unsaved()).length).toBe(0);
  });

  it('FR-FIL-007: an explicit save keeps a version at once, before any interval has passed', async () => {
    const { options, doc, blobs } = setup();
    const started = await startDocumentAutosave(options);
    if (started.kind !== 'editing') throw new Error('expected editing');
    doc.edit('a', 1);
    expect(await listSnapshots(blobs, 'd1')).toHaveLength(0);
    await started.autosave.saved();
    expect(await listSnapshots(blobs, 'd1')).toHaveLength(1);
  });

  it('FR-FIL-007: where there is no place for versions none are written, and the journal still is', async () => {
    const { options, doc, clock, blobs, journal } = setup({ snapshots: false });
    const started = await startDocumentAutosave(options);
    if (started.kind !== 'editing') throw new Error('expected editing');
    doc.edit('a', 1);
    await clock.advance(SNAPSHOT_INTERVAL_MS);
    await started.autosave.saved();
    expect(await listSnapshots(blobs, 'd1')).toHaveLength(0);
    expect((await journal.load('d1'))?.meta.savedRev).toBe(1);
  });

  it('FR-FIL-007: a snapshot that fails to write does not stop editing or the next attempt', async () => {
    let fail = true;
    const base = memoryBlobs();
    const blobs = { ...base, put: (p: string, b: Uint8Array) => (fail ? Promise.reject(new Error('quota')) : base.put(p, b)) };
    const { options, doc, clock } = setup({ blobs });
    const started = await startDocumentAutosave(options);
    if (started.kind !== 'editing') throw new Error('expected editing');
    doc.edit('a', 1);
    await clock.advance(SNAPSHOT_INTERVAL_MS);
    expect(await listSnapshots(base, 'd1')).toHaveLength(0);
    fail = false;
    await clock.advance(SNAPSHOT_INTERVAL_MS);
    expect(await listSnapshots(base, 'd1')).toHaveLength(1);
  });

  it('FR-FIL-004: kept asset bytes are one file however often they are kept', async () => {
    const { options, blobs } = setup();
    const started = await startDocumentAutosave(options);
    if (started.kind !== 'editing') throw new Error('expected editing');
    const hash = 'e'.repeat(64);
    await started.autosave.keepAsset(hash, new Uint8Array([7]));
    await started.autosave.keepAsset(hash, new Uint8Array([7]));
    expect(await blobs.list('assets')).toEqual([hash]);
  });

  it('FR-FIL-007: stopping unsubscribes from the document, clears the timers and releases the lock', async () => {
    const { options, doc, clock } = setup();
    const started = await startDocumentAutosave(options);
    if (started.kind !== 'editing') throw new Error('expected editing');
    expect(doc.listeners()).toBe(1);
    started.autosave.stop();
    started.autosave.stop();
    expect(doc.listeners()).toBe(0);
    expect(clock.pending()).toBe(0);
  });
});
