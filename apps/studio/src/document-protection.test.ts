import type { Store } from '@fluxion/core';
import type { AssetStore } from '@fluxion/editor';
import type { RecordId } from '@fluxion/schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocumentAutosave } from './autosave/document-autosave.js';
import { journalId, keepAssets } from './document-protection.js';
import type { OpenedEntry } from './opened-files.js';

const entry = (identity: string) => ({ identity }) as unknown as OpenedEntry;

describe('where a document is filed in the autosave (FR-FIL-007)', () => {
  it('FR-FIL-007: two files with the same name but different bytes are two documents, and the same file twice is one', () => {
    expect(journalId('file-1', entry('report.flux:aaaa'), 'x')).not.toBe(journalId('file-1', entry('report.flux:bbbb'), 'x'));
    expect(journalId('file-1', entry('report.flux:aaaa'), 'x')).toBe(journalId('file-2', entry('report.flux:aaaa'), 'y'));
  });

  it('FR-FIL-007: a new or bundled document is a different document in each tab', () => {
    expect(journalId('new', undefined, 'tab1')).not.toBe(journalId('new', undefined, 'tab2'));
  });
});

describe('keeping the bytes of new assets (FR-FIL-004, FR-FIL-007)', () => {
  afterEach(() => vi.useRealTimers());

  /** A store that announces one diff with an asset record, and an asset store that has no bytes until `give` is called. */
  function setup() {
    const listeners = new Set<(diff: unknown) => void>();
    const store = { subscribe: (l: (d: unknown) => void) => (listeners.add(l), () => void listeners.delete(l)) } as unknown as Store;
    let url: string | undefined;
    const assets = { url: () => url } as unknown as AssetStore;
    const kept: { hash: string; bytes: Uint8Array }[] = [];
    const autosave = { keepAsset: (hash: string, bytes: Uint8Array) => void kept.push({ hash, bytes }) } as unknown as DocumentAutosave;
    return {
      store,
      assets,
      kept,
      autosave,
      announce: () => {
        for (const l of listeners) l({ puts: new Map([['asset1', { after: { id: 'asset1' as RecordId, type: 'asset', hash: 'h'.repeat(64) } }]]) });
      },
      give: () => {
        url = 'data:image/png;base64,AQID';
      },
    };
  }

  it('FR-FIL-007: bytes that arrive after the record are kept on a later try, and nothing is kept for a record without them', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const s = setup();
    const stop = keepAssets(s.store, s.assets, () => s.autosave);
    s.announce();
    await vi.advanceTimersByTimeAsync(10);
    expect(s.kept).toHaveLength(0);
    s.give();
    await vi.advanceTimersByTimeAsync(1100);
    expect(s.kept.map((k) => [k.hash, [...k.bytes]])).toEqual([['h'.repeat(64), [1, 2, 3]]]);
    stop();
  });

  it('FR-FIL-007: stopping ends the waiting for bytes that never come', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const s = setup();
    const stop = keepAssets(s.store, s.assets, () => s.autosave);
    s.announce();
    await vi.advanceTimersByTimeAsync(10);
    stop();
    s.give();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.kept).toHaveLength(0);
  });
});
