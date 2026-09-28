import type { AnyRecord, DocumentFile, RecordId } from '@fluxion/schema';
import { arbDocument, documentBuilder } from '@fluxion/schema/testing';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Indexes } from './indexes.js';
import { effect } from './signals.js';
import { RecordStore } from './store.js';

type Op = { readonly kind: 'delete' | 'restore' | 'unparent' | 'move'; readonly pick: number; readonly to: number };
const arbOps = fc.array(fc.record({ kind: fc.constantFrom<Op['kind']>('delete', 'restore', 'unparent', 'move'), pick: fc.nat(), to: fc.nat() }), {
  minLength: 1,
  maxLength: 12,
});

/** One transaction per op, so the indexes see many incremental updates (committed or rejected). */
function run(store: RecordStore, original: Readonly<Record<string, AnyRecord>>, op: Op): void {
  const ids = Object.keys(original) as RecordId[];
  const id = ids[op.pick % ids.length] as RecordId;
  const screens = ids.filter((x) => original[x]?.type === 'screen');
  store.transact(op.kind, (tx) => {
    const current = tx.get(id);
    if (op.kind === 'delete') tx.delete(id);
    else if (op.kind === 'restore') tx.put(original[id] as AnyRecord);
    else if (op.kind === 'unparent' && current?.type === 'element') tx.patch(id, { parentId: undefined });
    else if (op.kind === 'move' && current?.type === 'element' && screens.length) tx.patch(id, { screenId: screens[op.to % screens.length] });
  });
}

describe('incremental indexes (03-core-engine §1)', () => {
  it('NFR-MNT-006: incrementally maintained indexes equal indexes rebuilt from scratch', () => {
    fc.assert(
      fc.property(arbDocument, arbOps, (file: DocumentFile, ops: Op[]) => {
        // validation off: rejected transactions would keep most ops from reaching the indexes
        for (const validate of [true, false]) {
          const store = new RecordStore(file, { validate });
          for (const op of ops) run(store, file.records as Record<string, AnyRecord>, op);
          const rebuilt = new Indexes(Object.values(store.toDocument().records) as AnyRecord[]);
          expect(store.indexSnapshot()).toEqual(rebuilt.snapshot());
        }
      }),
    );
  });

  it('members lists elements by screen and parent, records by type, bindings by element', () => {
    const b = documentBuilder({ seed: 5 });
    const s1 = b.screen();
    const s2 = b.screen();
    const a = b.rect(s1);
    const c = b.rect(s1);
    const d = b.rect(s2);
    const line = b.connect(a, c);
    const store = new RecordStore(b.build());
    expect(store.members('byScreen', s1).sort()).toEqual([a, c, line].sort());
    expect(store.members('byScreen', s2)).toEqual([d]);
    expect(store.members('byType', 'screen').sort()).toEqual([s1, s2].sort());
    expect(store.members('bindingsByElement', a)).toHaveLength(1);
    // the connector's own bindings, both ends (M3.12 review F2)
    expect(store.members('bindingsByElement', line)).toHaveLength(2);
    expect(store.members('byParent', a)).toEqual([]);
  });

  it('a query re-runs only when an index key or record it read changes', () => {
    const b = documentBuilder({ seed: 6 });
    const s1 = b.screen();
    const s2 = b.screen();
    const a = b.rect(s1);
    const d = b.rect(s2);
    const store = new RecordStore(b.build());
    let computations = 0;
    const onS1 = store.query((s) => {
      computations++;
      return s.members('byScreen', s1).length;
    });
    let seen = 0;
    const stop = effect(() => {
      seen = onS1();
    });
    expect([seen, computations]).toEqual([1, 1]);
    // another screen's element changes: the query does not re-run
    store.transact('move d', (tx) => tx.patch(d, { name: 'd' }));
    store.transact('add to s2', (tx) => tx.put({ ...(tx.get(d) as AnyRecord), id: 'OtherOtherOther1', index: 'a5' } as AnyRecord));
    expect([seen, computations]).toEqual([1, 1]);
    // an element joins s1: it re-runs once
    store.transact('move to s1', (tx) => tx.patch('OtherOtherOther1' as RecordId, { screenId: s1 }));
    expect([seen, computations]).toEqual([2, 2]);
    store.transact('rename a', (tx) => tx.patch(a, { name: 'a' }));
    expect(computations).toBe(2);
    stop();
  });

  it('an effect that writes through a transaction does not subscribe to the index keys it bumped (M3.12 review F1)', () => {
    const b = documentBuilder({ seed: 8 });
    const s1 = b.screen();
    const s2 = b.screen();
    const a = b.rect(s1);
    const d = b.rect(s2);
    const store = new RecordStore(b.build());
    // someone else watches s1, so its version signal exists
    const watcher = effect(() => {
      store.members('byScreen', s1);
    });
    let runs = 0;
    const stop = effect(() => {
      runs++;
      store.record$(a)();
      // a normalizer-like effect: reads a, writes d onto screen s1 once
      store.transact('pull d', (tx) => tx.patch(d, { screenId: s1 }));
    });
    expect(runs).toBe(1);
    // an unrelated transaction that adds to s1: the effect never read s1, so it must not re-run
    store.transact('add to s1', (tx) => tx.put({ ...(tx.get(a) as AnyRecord), id: 'NewNewNewNewNew1', index: 'a7' } as AnyRecord));
    expect(runs).toBe(1);
    store.transact('touch a', (tx) => tx.patch(a, { name: 'a' }));
    expect(runs).toBe(2);
    stop();
    watcher();
  });

  it('a query reading through get, has, ids and size re-runs when those change (M3.12 review r2 F1)', () => {
    const b = documentBuilder({ seed: 9 });
    const s1 = b.screen();
    const a = b.rect(s1);
    const store = new RecordStore(b.build());
    const names = store.query((v) => v.members('byScreen', s1).map((id) => (v.get(id) as { name?: string }).name ?? '-'));
    const present = store.query((v) => v.has(a));
    const count = store.query((v) => [v.size, v.ids().length]);
    const seen: unknown[] = [];
    const stop = effect(() => {
      seen.push([names(), present(), count()]);
    });
    const size = store.size;
    store.transact('rename', (tx) => tx.patch(a, { name: 'A' }));
    store.transact('add', (tx) => tx.put({ ...(tx.get(a) as AnyRecord), id: 'AddedAddedAdded1', index: 'a8', name: 'B' } as AnyRecord));
    store.transact('delete', (tx) => tx.delete('AddedAddedAdded1' as RecordId));
    expect(seen).toEqual([
      [['-'], true, [size, size]],
      [['A'], true, [size, size]],
      [['A', 'B'], true, [size + 1, size + 1]],
      [['A'], true, [size, size]],
    ]);
    stop();
  });

  it('a Tx used after its transaction throws instead of losing writes (M3.11 review F2)', () => {
    const b = documentBuilder({ seed: 7 });
    const a = b.rect(b.screen());
    const store = new RecordStore(b.build());
    let kept: { patch: (id: RecordId, f: Record<string, unknown>) => void } | undefined;
    store.transact('keep', (tx) => {
      kept = tx;
    });
    expect(() => kept?.patch(a, { name: 'late' })).toThrow(/transaction is closed/);
  });
});
