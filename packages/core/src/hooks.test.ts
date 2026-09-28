import { type AnyRecord, type DocumentFile, type RecordId, validate } from '@fluxion/schema';
import { arbDocument, documentBuilder } from '@fluxion/schema/testing';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type IntegrityHook, registerCoreHooks } from './hooks.js';
import { createRegistry } from './registry.js';
import { RecordStore } from './store.js';

function hookedStore(file: DocumentFile): RecordStore {
  const hooks = createRegistry<string, IntegrityHook>('integrityHooks');
  registerCoreHooks(hooks);
  return new RecordStore(file, { hooks });
}

type Plan = { readonly interactions: number[]; readonly comments: number[]; readonly timelines: number[]; readonly masters: Array<[number, number]> };
const arbPlan: fc.Arbitrary<Plan> = fc.record({
  interactions: fc.array(fc.nat(), { maxLength: 3 }),
  comments: fc.array(fc.nat(), { maxLength: 3 }),
  timelines: fc.array(fc.nat(), { maxLength: 2 }),
  masters: fc.array(fc.tuple(fc.nat(), fc.nat()), { maxLength: 2 }),
});
const rid = (prefix: string, n: number) => `${prefix}${String(n).padStart(16 - prefix.length, '0')}`;

/** A generated document plus behaviour records that point at its records (M3.14 review F1). */
function enrich(file: DocumentFile, plan: Plan): DocumentFile {
  const records: Record<string, unknown> = { ...file.records };
  const all = Object.keys(file.records);
  const ofType = (type: string) => all.filter((id) => (file.records[id] as AnyRecord).type === type);
  const [screens, elements] = [ofType('screen'), ofType('element')];
  const pick = <T>(xs: readonly T[], n: number): T | undefined => xs[n % Math.max(1, xs.length)];
  plan.interactions.forEach((n, i) => {
    records[rid('Int', i)] = { id: rid('Int', i), type: 'interaction', ownerId: pick(all, n), trigger: { kind: 'click' }, actions: [] };
  });
  plan.comments.forEach((n, i) => {
    records[rid('Com', i)] = { id: rid('Com', i), type: 'comment', targetId: pick(all, n), author: 'a', body: 'b' };
  });
  plan.timelines.forEach((n, i) => {
    records[rid('Tl', i)] = { id: rid('Tl', i), type: 'timeline', screenId: pick(screens, n), name: `t${i}`, index: `a${i}` };
    records[rid('St', i)] = { id: rid('St', i), type: 'step', timelineId: rid('Tl', i), index: 'a0', trigger: { kind: 'click' }, animations: [] };
  });
  for (const [a, b] of plan.masters) {
    const screen = pick(screens, a);
    const master = pick(screens, b);
    if (!screen || !master || screen === master) continue;
    records[screen] = { ...(records[screen] as object), masterId: master, ...(elements.length ? { parentElementId: pick(elements, a) } : {}) };
  }
  return { ...file, records: records as DocumentFile['records'] };
}

const errors = (store: RecordStore) => validate(store.toDocument()).filter((d) => d.severity === 'error');
const rec = (store: RecordStore, id: RecordId) => store.get(id) as (AnyRecord & Record<string, unknown>) | undefined;

describe('integrity hooks (ADR-0014, FR-EXT-001)', () => {
  it('FR-EXT-001: after any hook-run transaction validate reports 0 referential errors', () => {
    const arbDeletes = fc.array(fc.array(fc.nat(), { minLength: 1, maxLength: 4 }), { minLength: 1, maxLength: 4 });
    fc.assert(
      fc.property(arbDocument, arbPlan, arbDeletes, (generated: DocumentFile, plan: Plan, transactions: number[][]) => {
        const file = enrich(generated, plan);
        const store = hookedStore(file);
        expect(errors(store)).toEqual([]);
        for (const picks of transactions) {
          // anything but the document singleton, which no hook can replace
          const ids = store.ids().filter((id) => store.get(id)?.type !== 'document');
          if (!ids.length) break;
          const before = store.toDocument();
          const r = store.transact('delete', (tx) => {
            for (const pick of picks) tx.delete(ids[pick % ids.length] as RecordId);
          });
          // every cascade the hooks know commits; nothing is ever left dangling either way
          expect(r.ok, JSON.stringify(!r.ok && r.error)).toBe(true);
          if (!r.ok) expect(store.toDocument()).toEqual(before);
          expect(errors(store)).toEqual([]);
        }
      }),
    );
  });

  it('deleting a bound element frees the connector end at its centre; the other end keeps its binding', () => {
    const b = documentBuilder({ seed: 11 });
    const s = b.screen();
    const a = b.rect(s, { x: 0, y: 0, w: 100, h: 40 });
    const c = b.rect(s, { x: 300, y: 0, w: 100, h: 40 });
    const line = b.connect(a, c);
    const store = hookedStore(b.build());
    expect(store.transact('delete a', (tx) => tx.delete(a)).ok).toBe(true);
    expect(rec(store, line)?.['freeSource']).toEqual({ x: 50, y: 20 });
    expect(rec(store, line)?.['freeTarget']).toBeUndefined();
    expect(store.members('bindingsByElement', line)).toHaveLength(1);
    expect(errors(store)).toEqual([]);
  });

  it('deleting a connector deletes its bindings; deleting a binding frees its end', () => {
    const b = documentBuilder({ seed: 12 });
    const s = b.screen();
    const a = b.rect(s);
    const c = b.rect(s, { x: 300 });
    const line = b.connect(a, c);
    const store = hookedStore(b.build());
    const [first] = store.members('bindingsByElement', line);
    expect(store.transact('unbind', (tx) => tx.delete(first as RecordId)).ok).toBe(true);
    expect(errors(store)).toEqual([]);
    expect(store.transact('delete line', (tx) => tx.delete(line)).ok).toBe(true);
    expect(store.members('byType', 'binding')).toEqual([]);
    expect(errors(store)).toEqual([]);
  });

  it('deleting a group removes a subtree nested deeper than the pass limit', () => {
    const b = documentBuilder({ seed: 13 });
    const s = b.screen();
    const store = hookedStore(b.build());
    const group = (i: number, parentId?: string) =>
      ({
        id: `Group${String(i).padStart(11, '0')}`,
        type: 'element',
        kind: 'group',
        screenId: s,
        index: 'a0',
        transform: { x: 0, y: 0, w: 10, h: 10 },
        ...(parentId ? { parentId } : {}),
      }) as unknown as AnyRecord;
    const ids: RecordId[] = [];
    expect(
      store.transact('nest', (tx) => {
        for (let i = 0; i < 12; i++) {
          const g = group(i, ids.at(-1));
          tx.put(g);
          ids.push(g.id as RecordId);
        }
      }).ok,
    ).toBe(true);
    const r = store.transact('delete top', (tx) => tx.delete(ids[0] as RecordId));
    expect(r.ok).toBe(true);
    expect(ids.filter((id) => store.has(id))).toEqual([]);
    expect(errors(store)).toEqual([]);
  });

  it('deleting a screen deletes its elements, bindings, timelines and their steps', () => {
    const b = documentBuilder({ seed: 14 });
    const s1 = b.screen();
    const s2 = b.screen();
    const a = b.rect(s1);
    const c = b.rect(s1, { x: 300 });
    b.connect(a, c);
    const keep = b.rect(s2);
    const store = hookedStore(b.build());
    const timeline = { id: 'TimelineTimeline', type: 'timeline', screenId: s1, name: 'main', index: 'a0' } as unknown as AnyRecord;
    const step = {
      id: 'StepStepStepStep',
      type: 'step',
      timelineId: timeline.id,
      index: 'a0',
      trigger: { kind: 'click' },
      animations: [],
    } as unknown as AnyRecord;
    expect(store.transact('timeline', (tx) => (tx.put(timeline), tx.put(step))).ok).toBe(true);
    expect(store.transact('delete s1', (tx) => tx.delete(s1)).ok).toBe(true);
    expect(store.members('byScreen', s1)).toEqual([]);
    expect(store.has(timeline.id as RecordId) || store.has(step.id as RecordId)).toBe(false);
    expect(store.members('byType', 'binding')).toEqual([]);
    expect(store.has(keep)).toBe(true);
    expect(errors(store)).toEqual([]);
  });

  it('owned records go with their owner; a screen master or parent element is cleared (M3.14 review F1)', () => {
    const b = documentBuilder({ seed: 18 });
    const s1 = b.screen();
    const s2 = b.screen();
    const a = b.rect(s1);
    const store = hookedStore(b.build());
    const extra = [
      { id: rid('Int', 1), type: 'interaction', ownerId: a, trigger: { kind: 'click' }, actions: [] },
      { id: rid('Com', 1), type: 'comment', targetId: a, author: 'x', body: 'y' },
      { id: rid('Tl', 1), type: 'timeline', screenId: s2, name: 'main', index: 'a0' },
      { id: rid('St', 1), type: 'step', timelineId: rid('Tl', 1), index: 'a0', trigger: { kind: 'click' }, animations: [] },
    ] as unknown as AnyRecord[];
    expect(
      store.transact('add', (tx) => {
        for (const r of extra) tx.put(r);
      }).ok,
    ).toBe(true);
    expect(store.transact('link', (tx) => tx.patch(s2, { masterId: s1, parentElementId: a })).ok).toBe(true);
    expect(store.transact('delete a', (tx) => tx.delete(a)).ok).toBe(true);
    expect([rid('Int', 1), rid('Com', 1)].some((id) => store.has(id as RecordId))).toBe(false);
    expect(rec(store, s2)?.['parentElementId']).toBeUndefined();
    expect(store.transact('delete timeline', (tx) => tx.delete(rid('Tl', 1) as RecordId)).ok).toBe(true);
    expect(store.has(rid('St', 1) as RecordId)).toBe(false);
    expect(store.transact('delete master', (tx) => tx.delete(s1)).ok).toBe(true);
    expect(rec(store, s2)?.['masterId']).toBeUndefined();
    expect(errors(store)).toEqual([]);
  });

  it('a reply chain deeper than the pass limit goes in one pass (M3.14 review r2 F1)', () => {
    const b = documentBuilder({ seed: 21 });
    const a = b.rect(b.screen());
    const store = hookedStore(b.build());
    const chain = Array.from({ length: 12 }, (_, i) => ({
      id: rid('Rep', i),
      type: 'comment',
      targetId: i === 0 ? a : rid('Rep', i - 1),
      author: 'x',
      body: 'y',
    }));
    expect(
      store.transact('replies', (tx) => {
        for (const c of chain) tx.put(c as unknown as AnyRecord);
      }).ok,
    ).toBe(true);
    const r = store.transact('delete a', (tx) => tx.delete(a));
    expect(r.ok, JSON.stringify(!r.ok && r.error)).toBe(true);
    expect(chain.filter((c) => store.has(c.id as RecordId))).toEqual([]);
  });

  it('a group created and deleted in one transaction still takes its children (M3.14 review F2)', () => {
    const b = documentBuilder({ seed: 19 });
    const s = b.screen();
    const store = hookedStore(b.build());
    const group = {
      id: rid('Grp', 1),
      type: 'element',
      kind: 'group',
      screenId: s,
      index: 'a0',
      transform: { x: 0, y: 0, w: 9, h: 9 },
    } as unknown as AnyRecord;
    const child = {
      id: rid('Kid', 1),
      type: 'element',
      kind: 'shape',
      defId: 'basic:rect',
      screenId: s,
      parentId: group.id,
      index: 'a0',
      transform: { x: 0, y: 0, w: 1, h: 1 },
    } as unknown as AnyRecord;
    const r = store.transact('flash', (tx) => {
      tx.put(group);
      tx.put(child);
      tx.delete(group.id as RecordId);
    });
    expect(r.ok, JSON.stringify(!r.ok && r.error)).toBe(true);
    expect(store.has(child.id as RecordId)).toBe(false);
  });

  it('deleting an asset still in use is refused, not cascaded', () => {
    const b = documentBuilder({ seed: 20 });
    const s = b.screen();
    const store = hookedStore(b.build());
    const asset = { id: rid('Ast', 1), type: 'asset', hash: 'a'.repeat(64), mime: 'image/png', size: 1, name: 'x.png' } as unknown as AnyRecord;
    const image = {
      id: rid('Img', 1),
      type: 'element',
      kind: 'image',
      screenId: s,
      index: 'a0',
      transform: { x: 0, y: 0, w: 1, h: 1 },
      assetId: asset.id,
    } as unknown as AnyRecord;
    expect(store.transact('add', (tx) => (tx.put(asset), tx.put(image))).ok).toBe(true);
    const r = store.transact('delete asset', (tx) => tx.delete(asset.id as RecordId));
    expect(!r.ok && r.error.diagnostics.map((d) => d.code)).toContain('FLX_REF_MISSING');
    expect(store.has(asset.id as RecordId)).toBe(true);
  });

  it('hooks run sorted by key, whatever the registration order', () => {
    const b = documentBuilder({ seed: 15 });
    const a = b.rect(b.screen());
    const hooks = createRegistry<string, IntegrityHook>('integrityHooks');
    const order: string[] = [];
    hooks.register('b', () => order.push('b'), 'x');
    hooks.register('a', () => order.push('a'), 'x');
    const store = new RecordStore(b.build(), { hooks });
    store.transact('rename', (tx) => tx.patch(a, { name: 'n' }));
    expect(order).toEqual(['a', 'b']);
  });

  it('FR-EXT-001: an idempotent hook that re-writes an equal value settles', () => {
    const b = documentBuilder({ seed: 22 });
    const a = b.rect(b.screen());
    const hooks = createRegistry<string, IntegrityHook>('integrityHooks');
    let passes = 0;
    // a normalising hook that always writes, even when the value is already right (M3 cp1 F5)
    hooks.register(
      'normalise',
      ({ tx }) => {
        passes++;
        tx.patch(a, { name: 'normal' });
      },
      'x',
    );
    const store = new RecordStore(b.build(), { hooks });
    const r = store.transact('rename', (tx) => tx.patch(a, { name: 'raw' }));
    expect(r.ok, JSON.stringify(!r.ok && r.error)).toBe(true);
    expect(rec(store, a)?.['name']).toBe('normal');
    expect(passes).toBe(2);
  });

  it('non-converging hooks end the transaction with TX_HOOK_DEPTH and change nothing', () => {
    const b = documentBuilder({ seed: 16 });
    const a = b.rect(b.screen());
    const hooks = createRegistry<string, IntegrityHook>('integrityHooks');
    let n = 0;
    hooks.register('restless', ({ tx }) => tx.patch(a, { name: `n${n++}` }), 'x');
    const store = new RecordStore(b.build(), { hooks });
    const r = store.transact('rename', (tx) => tx.patch(a, { name: 'start' }));
    expect(!r.ok && r.error.code).toBe('TX_HOOK_DEPTH');
    expect(n).toBe(8);
    expect(rec(store, a)?.['name']).toBeUndefined();
  });
});
