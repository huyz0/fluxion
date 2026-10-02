// Integrity hooks, continued: the built-ins cascade exactly as far as they should (M4.8 mutation triage).
import type { AnyRecord, DocumentFile, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { type IntegrityHook, pendingMembers, registerCoreHooks } from './hooks.js';
import { createRegistry } from './registry.js';
import { RecordStore } from './store.js';

function hookedStore(file: DocumentFile): RecordStore {
  const hooks = createRegistry<string, IntegrityHook>('integrityHooks');
  registerCoreHooks(hooks);
  return new RecordStore(file, { hooks });
}

const rid = (prefix: string, n: number) => `${prefix}${String(n).padStart(16 - prefix.length, '0')}`;

const rec = (store: RecordStore, id: RecordId) => store.get(id) as (AnyRecord & Record<string, unknown>) | undefined;

describe('integrity hooks: cascade details (ADR-0014, FR-EXT-001)', () => {
  it('FR-EXT-001: the built-in hooks are registered under their ordered core keys as source core', () => {
    const hooks = createRegistry<string, IntegrityHook>('integrityHooks');
    expect(registerCoreHooks(hooks)).toEqual([]);
    const keys = ['core:1-screens', 'core:2-subtrees', 'core:3-owned', 'core:4-bindings', 'core:5-group-bounds'];
    expect(hooks.list().map(([key]) => key)).toEqual(keys);
    expect(keys.map((key) => hooks.source(key))).toEqual(keys.map(() => 'core'));
  });

  it('FR-EXT-001: deleting a screen deletes only its own timelines', () => {
    const b = documentBuilder({ seed: 23 });
    const s1 = b.screen();
    const s2 = b.screen();
    const store = hookedStore(b.build());
    const timeline = (id: string, screenId: RecordId) => ({ id, type: 'timeline', screenId, name: id, index: 'a0' }) as unknown as AnyRecord;
    expect(
      store.transact('timelines', (tx) => {
        tx.put(timeline(rid('Tl', 1), s1));
        tx.put(timeline(rid('Tl', 2), s2));
      }).ok,
    ).toBe(true);
    expect(store.transact('delete s1', (tx) => tx.delete(s1)).ok).toBe(true);
    expect([store.has(rid('Tl', 1) as RecordId), store.has(rid('Tl', 2) as RecordId)]).toEqual([false, true]);
  });

  it('FR-EXT-001: a deleted record cascades only as its own type (a screen is not a parent)', () => {
    const b = documentBuilder({ seed: 24 });
    const s1 = b.screen();
    const s2 = b.screen();
    const e = b.rect(s2);
    const file = b.build();
    // an (invalid) element whose parentId names a screen: only a deleted element takes its children
    const records = { ...file.records, [e]: { ...(file.records[e] as AnyRecord), parentId: s1 } as AnyRecord };
    const hooks = createRegistry<string, IntegrityHook>('integrityHooks');
    registerCoreHooks(hooks);
    const store = new RecordStore({ ...file, records }, { hooks, validate: false });
    expect(store.transact('delete s1', (tx) => tx.delete(s1)).ok).toBe(true);
    expect(store.has(e)).toBe(true);
  });

  it('FR-EXT-001: a screen deleted with its master is not patched; one that stays has its master cleared', () => {
    const b = documentBuilder({ seed: 25 });
    const s1 = b.screen();
    const s2 = b.screen();
    const s3 = b.screen();
    const store = hookedStore(b.build());
    expect(
      store.transact('link', (tx) => {
        tx.patch(s2, { masterId: s1 });
        tx.patch(s3, { masterId: s1 });
      }).ok,
    ).toBe(true);
    const r = store.transact('delete s1 and s2', (tx) => {
      tx.delete(s1);
      tx.delete(s2);
    });
    expect(r.ok, JSON.stringify(!r.ok && r.error)).toBe(true);
    expect([store.has(s1), store.has(s2), store.has(s3)]).toEqual([false, false, true]);
    expect(rec(store, s3)?.['masterId']).toBeUndefined();
  });

  it('FR-EXT-001: a record an earlier hook restores keeps what it owns', () => {
    const b = documentBuilder({ seed: 26 });
    const a = b.rect(b.screen());
    const hooks = createRegistry<string, IntegrityHook>('integrityHooks');
    registerCoreHooks(hooks);
    const store = new RecordStore(b.build(), { hooks });
    const interaction = { id: rid('Int', 1), type: 'interaction', ownerId: a, trigger: { kind: 'click' }, actions: [] } as unknown as AnyRecord;
    expect(store.transact('add', (tx) => tx.put(interaction)).ok).toBe(true);
    const kept = store.get(a) as AnyRecord;
    // an undelete hook sorted before the core ones puts `a` back in the same pass
    hooks.register('core:0-undelete', ({ tx, deleted }) => deleted.has(a) && !tx.get(a) && tx.put(kept), 'x');
    const r = store.transact('delete a', (tx) => tx.delete(a));
    expect(r.ok, JSON.stringify(!r.ok && r.error)).toBe(true);
    expect([store.has(a), store.has(interaction.id as RecordId)]).toEqual([true, true]);
  });

  it('FR-EXT-001: deleting a binding frees its end at the bound element centre', () => {
    const b = documentBuilder({ seed: 27 });
    const s = b.screen();
    const a = b.rect(s, { x: 0, y: 0, w: 100, h: 40 });
    const c = b.rect(s, { x: 300, y: 100, w: 100, h: 40 });
    const line = b.connect(a, c);
    const store = hookedStore(b.build());
    const target = store.members('bindingsByElement', c)[0] as RecordId;
    expect(store.transact('unbind', (tx) => tx.delete(target)).ok).toBe(true);
    expect(rec(store, line)?.['freeTarget']).toEqual({ x: 350, y: 120 });
    expect(rec(store, line)?.['freeSource']).toBeUndefined();
  });

  it('FR-EXT-001: an end re-bound in the same transaction is not freed', () => {
    const b = documentBuilder({ seed: 28 });
    const s = b.screen();
    const a = b.rect(s);
    const c = b.rect(s, { x: 300 });
    const e = b.rect(s, { x: 600 });
    const line = b.connect(a, c);
    const store = hookedStore(b.build());
    const old = store.members('bindingsByElement', c)[0] as RecordId;
    const rebound = { ...(store.get(old) as AnyRecord), id: rid('Bnd', 1), elementId: e } as AnyRecord;
    const r = store.transact('re-point', (tx) => {
      tx.delete(old);
      tx.put(rebound);
    });
    expect(r.ok, JSON.stringify(!r.ok && r.error)).toBe(true);
    expect(rec(store, line)?.['freeTarget']).toBeUndefined();
    expect(store.members('bindingsByElement', line)).toHaveLength(2);
  });

  it('FR-EXT-001: a binding from another connector does not hold this connector end', () => {
    const b = documentBuilder({ seed: 29 });
    const s = b.screen();
    const a = b.rect(s);
    const c = b.rect(s, { x: 300 });
    const line = b.connect(a, c);
    const store = hookedStore(b.build());
    // a second connector whose target end is bound to `line` itself, end `target` too
    const other = { ...(store.get(line) as AnyRecord), id: rid('Con', 1), index: 'a8' } as AnyRecord;
    const onLine = {
      ...(store.get(store.members('bindingsByElement', c)[0] as RecordId) as AnyRecord),
      id: rid('Bnd', 2),
      connectorId: other.id,
      elementId: line,
    } as AnyRecord;
    const onA = { ...(store.get(store.members('bindingsByElement', a)[0] as RecordId) as AnyRecord), id: rid('Bnd', 3), connectorId: other.id } as AnyRecord;
    const r = store.transact('other', (tx) => {
      for (const r of [other, onA, onLine]) tx.put(r);
    });
    expect(r.ok, JSON.stringify(!r.ok && r.error)).toBe(true);
    const target = store.members('bindingsByElement', c).find((id) => rec(store, id)?.['connectorId'] === line) as RecordId;
    expect(store.transact('unbind', (tx) => tx.delete(target)).ok).toBe(true);
    expect(rec(store, line)?.['freeTarget']).toBeDefined();
  });

  it('FR-EXT-001: a binding created and deleted in one transaction leaves a free end where it was', () => {
    const b = documentBuilder({ seed: 30 });
    const s = b.screen();
    const a = b.rect(s);
    const c = b.rect(s, { x: 300 });
    const line = b.connect(a, { x: 900, y: 900 });
    const store = hookedStore(b.build());
    const free = rec(store, line)?.['freeTarget'];
    expect(free).toBeDefined();
    const source = store.members('bindingsByElement', a)[0] as RecordId;
    const flash = { ...(store.get(source) as AnyRecord), id: rid('Bnd', 4), end: 'target', elementId: c } as AnyRecord;
    const r = store.transact('flash', (tx) => {
      tx.put(flash);
      tx.delete(flash.id as RecordId);
    });
    expect(r.ok, JSON.stringify(!r.ok && r.error)).toBe(true);
    expect(rec(store, line)?.['freeTarget']).toEqual(free);
  });

  it('FR-EXT-001: hooks see a record moved off a screen, and members follow earlier hooks of the pass', () => {
    const b = documentBuilder({ seed: 31 });
    const s1 = b.screen();
    const s2 = b.screen();
    const a = b.rect(s1);
    const stay = b.rect(s1, { x: 300 });
    const store = hookedStore(b.build());
    // moved to s2 in the same transaction that deletes s1: it is no longer s1's element
    const r = store.transact('move and delete', (tx) => {
      tx.patch(a, { screenId: s2 });
      tx.delete(s1);
    });
    expect(r.ok, JSON.stringify(!r.ok && r.error)).toBe(true);
    expect([store.has(a), store.has(stay)]).toEqual([true, false]);

    const b2 = documentBuilder({ seed: 32 });
    const t = b2.screen();
    const kept = b2.rect(t);
    const hooks = createRegistry<string, IntegrityHook>('integrityHooks');
    const seen: RecordId[][] = [];
    const fresh = { ...(b2.build().records[kept] as AnyRecord), id: rid('New', 1), index: 'a7' } as AnyRecord;
    // `a` deletes the record the transaction created and touches the committed one; `b` looks
    hooks.register(
      'a',
      ({ tx }) => {
        if (!tx.get(fresh.id as RecordId)) return;
        tx.delete(fresh.id as RecordId);
        tx.patch(kept, { name: 'k' });
      },
      'x',
    );
    hooks.register('b', ({ members }) => seen.push(members('byScreen', t).sort()), 'x');
    const store2 = new RecordStore(b2.build(), { hooks });
    expect(store2.transact('add', (tx) => tx.put(fresh)).ok).toBe(true);
    expect(seen[0]).toEqual([kept]);
  });

  it('FR-EXT-001: pending members match the index as well as the key', () => {
    const id = 'MovedMovedMoved1' as RecordId;
    // committed under byParent K; pending as an element of screen K (same key, other index)
    const moved = { id, type: 'element', screenId: 'K' } as unknown as AnyRecord;
    const changes = new Map<RecordId, AnyRecord | null>([[id, moved]]);
    const tx = { get: (x: RecordId) => changes.get(x) ?? undefined, put: () => {}, patch: () => {}, delete: () => {} };
    const members = pendingMembers((index, key) => (index === 'byParent' && key === 'K' ? [id] : []), changes, tx);
    expect(members('byParent', 'K')).toEqual([]);
    expect(members('byScreen', 'K')).toEqual([id]);
  });

  it('hooks do not run for undo and redo transactions', () => {
    const b = documentBuilder({ seed: 17 });
    const a = b.rect(b.screen());
    const hooks = createRegistry<string, IntegrityHook>('integrityHooks');
    let runs = 0;
    hooks.register('count', () => runs++, 'x');
    const store = new RecordStore(b.build(), { hooks });
    store.transact('user', (tx) => tx.patch(a, { name: '1' }));
    const afterUser = runs;
    // replays go through the history module (a direct undo/redo origin is refused: M4.4)
    expect(store.history.undo().ok).toBe(true);
    expect(store.history.redo().ok).toBe(true);
    expect((store.get(a) as { name?: string }).name).toBe('1');
    expect(afterUser).toBeGreaterThan(0);
    expect(runs).toBe(afterUser);
  });
});
