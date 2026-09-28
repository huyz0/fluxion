import type { AnyRecord, DocumentFile, RecordId } from '@fluxion/schema';
import { arbDocument, documentBuilder } from '@fluxion/schema/testing';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { RecordStore } from './store.js';
import type { Diff, Tx, TxMeta } from './transaction.js';

type Op = { readonly kind: 'patch' | 'delete' | 'recreate'; readonly pick: number; readonly n: number };
const arbOps = fc.array(fc.record({ kind: fc.constantFrom<Op['kind']>('patch', 'delete', 'recreate'), pick: fc.nat(), n: fc.integer({ min: 0, max: 3 }) }), {
  minLength: 1,
  maxLength: 6,
});

/** Record the transactions a store announces. */
function listen(store: RecordStore): Array<[Diff, TxMeta]> {
  const seen: Array<[Diff, TxMeta]> = [];
  store.subscribe((diff, meta) => seen.push([diff, meta]));
  return seen;
}

/** Apply one generated operation to the record `ids[op.pick]`. */
// recreate puts the record's original value back even after a delete, so creates are committed too
function applyOp(tx: Tx, original: Readonly<Record<string, unknown>>, ids: readonly RecordId[], op: Op): void {
  const id = ids[op.pick % ids.length] as RecordId;
  const current = tx.get(id);
  if (op.kind === 'delete') tx.delete(id);
  else if (current && op.kind === 'patch') tx.patch(id, { meta: { n: op.n } });
  else if (op.kind === 'recreate') tx.put({ ...(original[id] as AnyRecord), meta: { n: op.n } } as AnyRecord);
}

/** The diff is exactly the difference between `pre` and `post`, with no no-op entries. */
function expectDiffReplays(pre: Readonly<Record<string, unknown>>, post: Readonly<Record<string, unknown>>, diff: Diff): void {
  expect(Object.keys(diff).sort()).toEqual(['deletes', 'puts']);
  const replayed: Record<string, unknown> = { ...pre };
  for (const [id, { before, after }] of diff.puts) {
    expect(before).toEqual(pre[id]);
    expect(after).not.toEqual(before);
    replayed[id] = after;
  }
  for (const [id, before] of diff.deletes) {
    expect(before).toEqual(pre[id]);
    delete replayed[id];
  }
  expect(replayed).toEqual(post);
}

function fixture() {
  const b = documentBuilder({ seed: 3 });
  const screen = b.screen();
  const a = b.rect(screen, { x: 0 });
  const c = b.rect(screen, { x: 300 });
  const line = b.connect(a, c);
  return { file: b.build(), screen, a, c, line };
}

describe('transactions (ADR-0014, NFR-MNT-006)', () => {
  it('NFR-MNT-006: every transaction emits record puts/deletes only', () => {
    fc.assert(
      fc.property(arbDocument, arbOps, (file: DocumentFile, ops: Op[]) => {
        const store = new RecordStore(file);
        const seen = listen(store);
        const pre = store.toDocument().records;
        const ids = store.ids();
        const result = store.transact('ops', (tx) => {
          for (const op of ops) applyOp(tx, pre, ids, op);
        });
        const post = store.toDocument().records;
        if (!result.ok) {
          // rolled back: nothing changed and nothing was announced
          expect(post).toEqual(pre);
          expect(seen).toEqual([]);
          return;
        }
        expect(seen.length).toBeLessThanOrEqual(1);
        expectDiffReplays(pre, post, seen[0]?.[0] ?? { puts: new Map(), deletes: new Map() });
      }),
    );
  });

  it('NFR-MNT-006: a created record is committed as a put without before', () => {
    const { file, screen } = fixture();
    const store = new RecordStore(file);
    const seen = listen(store);
    const id = 'NewShapeNewShape' as RecordId;
    const shape = { id, type: 'element', screenId: screen, index: 'a9', kind: 'shape', defId: 'basic:rect', transform: { x: 1, y: 2, w: 3, h: 4 } };
    expect(store.transact('create', (tx) => tx.put(shape as AnyRecord)).ok).toBe(true);
    const [diff] = seen[0] ?? [];
    expect(diff?.puts.get(id)).toEqual({ after: shape });
    expect(diff?.puts.get(id)?.before).toBeUndefined();
    expect(store.get(id)).toEqual(shape);
    // deleted, then put back in a later transaction: a create again
    store.transact('delete', (tx) => tx.delete(id));
    expect(store.transact('recreate', (tx) => tx.put(shape as AnyRecord)).ok).toBe(true);
    expect(seen[2]?.[0].puts.get(id)).toEqual({ after: shape });
  });

  it('NFR-MNT-006: IF a put is invalid THEN the transaction SHALL roll back with diagnostics', () => {
    const { file, a, c } = fixture();
    const store = new RecordStore(file);
    const seen = listen(store);
    const before = store.toDocument();
    const r = store.transact('break', (tx) => {
      tx.patch(c, { name: 'fine' });
      const { transform: _t, ...broken } = tx.get(a) as AnyRecord & { transform: unknown };
      tx.put(broken as AnyRecord);
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('TX_INVALID');
    expect(r.error.diagnostics.map((d) => d.path)).toContain(`/records/${a}/transform`);
    expect(store.toDocument()).toEqual(before);
    expect(seen).toEqual([]);
  });

  it('a change that breaks a reference elsewhere is rejected; errors the document already had are not', () => {
    const { file, screen, a } = fixture();
    const store = new RecordStore(file);
    // deleting the screen strands its elements (hooks that cascade arrive in M3.14)
    const r = store.transact('delete screen', (tx) => tx.delete(screen));
    expect(!r.ok && r.error.diagnostics.map((d) => d.code)).toContain('FLX_REF_MISSING');
    expect(store.has(screen)).toBe(true);
    // a document with a dangling reference already: an unrelated change still commits
    const dangling = new RecordStore({ ...file, records: { ...file.records, [a]: { ...file.records[a], parentId: 'gone' } as AnyRecord } });
    expect(dangling.transact('rename', (tx) => tx.patch(a, { name: 'x' })).ok).toBe(true);
  });

  it('a throw rolls back and is rethrown; the store stays usable', () => {
    const { file, a } = fixture();
    const store = new RecordStore(file);
    const seen = listen(store);
    expect(() =>
      store.transact('boom', (tx) => {
        tx.patch(a, { name: 'half' });
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect((store.get(a) as { name?: string }).name).toBeUndefined();
    expect(seen).toEqual([]);
    expect(store.transact('after', (tx) => tx.patch(a, { name: 'ok' })).ok).toBe(true);
    // patching a missing record or changing identity is a programmer error
    expect(() => store.transact('missing', (tx) => tx.patch('nope' as RecordId, {}))).toThrow(/no record/);
    expect(() => store.transact('retype', (tx) => tx.patch(a, { type: 'screen' }))).toThrow(/cannot change id or type/);
  });

  it('the diff is net: create-then-delete and unchanged writes drop out; an empty diff is silent', () => {
    const { file, a, c } = fixture();
    const store = new RecordStore(file);
    const seen = listen(store);
    const r = store.transact('noop', (tx) => {
      const copy = { ...(tx.get(a) as AnyRecord), id: 'tmp' } as AnyRecord;
      tx.put(copy);
      tx.delete('tmp' as RecordId);
      tx.put(tx.get(c) as AnyRecord);
      tx.patch(a, { name: 'x' });
      tx.patch(a, { name: undefined });
    });
    expect(r).toEqual({ ok: true, value: undefined });
    expect(seen).toEqual([]);
  });

  it('an inner transact that throws undoes only its own writes (savepoint, ADR-0014 amendment)', () => {
    const { file, a, c } = fixture();
    const store = new RecordStore(file);
    const r = store.transact('outer', (tx) => {
      tx.patch(a, { name: 'kept' });
      try {
        store.transact('inner', (t) => {
          t.patch(c, { name: 'half' });
          t.patch(a, { name: 'overwritten' });
          throw new Error('inner');
        });
      } catch {
        // the outer command handles the inner failure and carries on
      }
      expect((tx.get(a) as { name?: string }).name).toBe('kept');
    });
    expect(r.ok).toBe(true);
    expect((store.get(a) as { name?: string }).name).toBe('kept');
    expect((store.get(c) as { name?: string }).name).toBeUndefined();
  });

  it('a reference moved from one missing target to another counts as a new error', () => {
    const { file, a } = fixture();
    const store = new RecordStore({ ...file, records: { ...file.records, [a]: { ...file.records[a], parentId: 'gone' } as AnyRecord } });
    const r = store.transact('repoint', (tx) => tx.patch(a, { parentId: 'elsewhere' }));
    expect(!r.ok && r.error.diagnostics.map((d) => d.code)).toContain('FLX_REF_MISSING');
  });

  it('a nested transact joins the outer one: one diff, the outermost options', () => {
    const { file, a, c } = fixture();
    const store = new RecordStore(file);
    const seen = listen(store);
    const r = store.transact(
      'outer',
      (tx) => {
        tx.patch(a, { name: 'a' });
        const inner = store.transact('inner', (t) => (t.patch(c, { name: 'c' }), 42), { origin: 'system' });
        expect(inner).toEqual({ ok: true, value: 42 });
        return 'done';
      },
      { mergeKey: 'k' },
    );
    expect(r).toEqual({ ok: true, value: 'done' });
    expect(seen).toHaveLength(1);
    const [diff, meta] = seen[0] ?? [];
    expect([...(diff?.puts.keys() ?? [])].sort()).toEqual([a, c].sort());
    expect(meta).toEqual({ label: 'outer', origin: 'user', mergeKey: 'k' });
  });

  it('committed records are deep-frozen and reads inside see the transaction', () => {
    const { file, a } = fixture();
    const store = new RecordStore(file);
    store.transact('move', (tx) => {
      tx.patch(a, { transform: { x: 5, y: 5, w: 10, h: 10 } });
      expect((tx.get(a) as { transform: { x: number } }).transform.x).toBe(5);
    });
    const rec = store.get(a) as AnyRecord & { transform: object };
    expect(Object.isFrozen(rec.transform)).toBe(true);
  });

  it('validation can be switched off by the store option (production builds only)', () => {
    const { file, screen } = fixture();
    const store = new RecordStore(file, { validate: false });
    expect(store.transact('delete screen', (tx) => tx.delete(screen)).ok).toBe(true);
    expect(store.has(screen)).toBe(false);
  });
});
