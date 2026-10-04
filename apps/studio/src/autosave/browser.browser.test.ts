import { afterEach, describe, expect, it, vi } from 'vitest';
import { type BrowserAutosave, browserAutosave } from './browser.js';

const opened: BrowserAutosave[] = [];
afterEach(() => {
  for (const b of opened.splice(0)) b.close();
});

describe("the autosave on the browser's storage (FR-FIL-007, ADR-0024)", () => {
  it('FR-FIL-007: chromium gives a durable journal, versions in OPFS and a lock that a second holder cannot take', async () => {
    const env = await browserAutosave();
    opened.push(env);
    expect(env.durable).toBe(true);
    expect(env.snapshots).toBe(true);
    expect(env.blobs).toBeDefined();
    const name = `test-lock-${Date.now()}`;
    const first = await env.lock.acquire(name);
    expect(first).toBeDefined();
    expect(await env.lock.acquire(name)).toBeUndefined();
    first?.();
    // a released lock is free a moment later, not in the same turn
    const again = await vi.waitFor(async () => {
      const taken = await env.lock.acquire(name);
      if (taken === undefined) throw new Error('still held');
      return taken;
    });
    again();
  });

  it('FR-FIL-007: IndexedDB that refuses to open gives a journal in memory that says it is not durable, and still works', async () => {
    const refusing = {
      open() {
        throw new DOMException('denied', 'SecurityError');
      },
    } as unknown as IDBFactory;
    const env = await browserAutosave({ indexedDB: refusing });
    opened.push(env);
    expect(env.durable).toBe(false);
    expect(env.snapshots).toBe(false);
    await env.journal.setSaved('nothing', 1);
    expect(await env.journal.unsaved()).toEqual([]);
  });

  it('FR-FIL-007: with no OPFS the asset bytes go to the assets store and there are no versions', async () => {
    const env = await browserAutosave({ storage: {} as StorageManager });
    opened.push(env);
    expect(env.durable).toBe(true);
    expect(env.snapshots).toBe(false);
    await env.blobs?.put('assets/x', new Uint8Array([1]));
    expect(await env.blobs?.get('assets/x')).toEqual(new Uint8Array([1]));
  });

  it('FR-FIL-007: persistence is asked for once and reported as granted or not; without a storage manager it is not granted', async () => {
    const granted = await browserAutosave({
      storage: { persist: () => Promise.resolve(true), persisted: () => Promise.resolve(false) } as unknown as StorageManager,
    });
    opened.push(granted);
    expect(await granted.persist()).toBe(true);
    const none = await browserAutosave({ storage: undefined });
    opened.push(none);
    expect(await none.persist()).toBe(false);
  });
});
