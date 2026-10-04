import type { AnyRecord, RecordId } from '@fluxion/schema';
import { SCHEMA_VERSION } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { putAssetBytes } from './asset-bytes.js';
import { createAutosave, type Timers } from './autosave.js';
import { memoryBlobs } from './blobs.js';
import type { LockPort } from './document-autosave.js';
import { documentOf, findRecoverable, previewOf, recoveredAssets } from './recovery.js';
import { memoryAutosaveStore } from './store.js';

const id = (s: string) => s as RecordId;
const record = (name: string, extra: object = {}): AnyRecord => ({ id: id(name), type: 'screen', ...extra }) as AnyRecord;
const diff = (name: string, r: AnyRecord) => ({ puts: new Map([[name, { after: r }]]), deletes: new Map<string, unknown>() });
const timers: Timers = { now: () => 0, setTimeout: () => 0, clearTimeout: () => undefined };

/** A document edited `edits` times and flushed, in `store` under `docId`. */
async function edited(store: ReturnType<typeof memoryAutosaveStore>, docId: string, edits: number, title = 'A deck') {
  const records: { [k: string]: AnyRecord } = { base: record('base') };
  const autosave = createAutosave({
    docId,
    store,
    timers,
    iso: () => '2026-10-04T10:00:00.000Z',
    records: () => records,
    title: () => title,
    base: { records: { base: record('base') }, rev: 0, seq: 0 },
  });
  for (let i = 1; i <= edits; i++) {
    records[`s${i}`] = record(`s${i}`);
    autosave.change(diff(`s${i}`, record(`s${i}`)), i);
  }
  await autosave.flush();
  return autosave;
}

const locks = (held: string[] = []): LockPort => ({
  acquire: (name) => Promise.resolve(held.includes(name) ? undefined : () => undefined),
});

describe('finding what a crash left (FR-FIL-007, NFR-REL-001)', () => {
  it('FR-FIL-007: a document with unsaved changes that nobody is editing is offered, rebuilt with its changes, summarised for the prompt', async () => {
    const store = memoryAutosaveStore();
    await edited(store, 'new~a', 3, 'Quarterly review');
    const [found, ...rest] = await findRecoverable(store, locks());
    expect(rest).toHaveLength(0);
    expect(found?.id).toBe('new~a');
    const preview = previewOf(found as NonNullable<typeof found>);
    expect(preview).toMatchObject({ title: 'Quarterly review', screens: 4, records: 4, changes: 3 });
    expect(preview.warning).toBeUndefined();
    expect(documentOf(found as NonNullable<typeof found>).schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('FR-FIL-007: a document saved to its file, or one another tab is editing right now, is not offered', async () => {
    const store = memoryAutosaveStore();
    const saved = await edited(store, 'saved', 2);
    await saved.saved(2);
    await edited(store, 'live', 2);
    await edited(store, 'orphan', 1);
    const found = await findRecoverable(store, locks(['fluxion-doc:live']));
    expect(found.map((f) => f.id)).toEqual(['orphan']);
  });

  it('NFR-REL-001: a torn journal is recovered up to the last good change and the prompt says what was lost', async () => {
    const store = memoryAutosaveStore();
    await edited(store, 'torn', 3);
    const stored = await store.load('torn');
    const last = stored?.entries.at(-1);
    await store.commit('torn', {
      entries: [{ seq: (last?.seq ?? 0) + 1, text: '{"seq":' }],
      meta: { ...(stored?.meta as NonNullable<typeof stored>['meta']), headRev: 4 },
    });
    const [found] = await findRecoverable(store, locks());
    const preview = previewOf(found as NonNullable<typeof found>);
    expect(preview.changes).toBe(3);
    expect(preview.warning).toMatch(/1 later change could not be read/);
  });

  it('NFR-REL-001: a journal that cannot be read recovers nothing instead of failing', async () => {
    const broken = { ...memoryAutosaveStore(), unsaved: () => Promise.reject(new Error('gone')) };
    expect(await findRecoverable(broken, locks())).toEqual([]);
  });

  it("FR-FIL-004: the asset bytes autosave kept come back by hash with the record's type, and a missing one is left out", async () => {
    const store = memoryAutosaveStore();
    const blobs = memoryBlobs();
    const hash = 'a'.repeat(64);
    const lost = 'b'.repeat(64);
    const records: { [k: string]: AnyRecord } = { base: record('base') };
    const autosave = createAutosave({
      docId: 'img',
      store,
      timers,
      iso: () => 't',
      records: () => records,
      title: () => 'Pictures',
      base: { records, rev: 0, seq: 0 },
    });
    for (const [n, h] of [
      ['asset1', hash],
      ['asset2', lost],
    ] as const) {
      records[n] = { id: id(n), type: 'asset', hash: h, mime: 'image/png' } as unknown as AnyRecord;
      autosave.change(diff(n, records[n] as AnyRecord), 1);
    }
    await autosave.flush();
    await putAssetBytes(blobs, hash, new Uint8Array([9]));
    const [found] = await findRecoverable(store, locks());
    const assets = await recoveredAssets(found as NonNullable<typeof found>, blobs);
    expect([...assets.keys()]).toEqual([hash]);
    expect(assets.get(hash)).toEqual({ bytes: new Uint8Array([9]), mime: 'image/png' });
    expect((await recoveredAssets(found as NonNullable<typeof found>, undefined)).size).toBe(0);
  });
});
