import type { AnyRecord, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { type IntegrityHook, registerCoreHooks } from './hooks.js';
import { createRegistry } from './registry.js';
import { effect } from './signals.js';
import { createStore, RecordStore } from './store.js';

function fixture() {
  const b = documentBuilder({ seed: 1 });
  const screen = b.screen();
  const a = b.rect(screen, { x: 0 });
  const c = b.rect(screen, { x: 200 });
  const file = b.build();
  return { file, screen, a, c };
}

/** Count how often an effect reading `read` runs (the first run included). */
function counter(read: () => unknown): { runs: number; stop: () => void } {
  const out = { runs: 0, stop: () => {} };
  out.stop = effect(() => {
    read();
    out.runs++;
  });
  return out;
}

describe('RecordStore (ADR-0002, 03-core-engine §1)', () => {
  it("NFR-MNT-006: WHEN one record changes THE SYSTEM SHALL notify only that record's subscribers", () => {
    const { file, screen, a, c } = fixture();
    const store = new RecordStore(file);
    const onA = counter(store.record$(a));
    const onC = counter(store.record$(c));
    const onScreen = counter(store.record$(screen));
    expect([onA.runs, onC.runs, onScreen.runs]).toEqual([1, 1, 1]);

    const before = store.get(a) as AnyRecord & { name?: string };
    store.apply([{ ...before, name: 'moved' } as AnyRecord], []);
    expect([onA.runs, onC.runs, onScreen.runs]).toEqual([2, 1, 1]);
    expect(store.record$(a)()).toBe(store.get(a));

    store.apply([], [c]);
    expect([onA.runs, onC.runs, onScreen.runs]).toEqual([2, 2, 1]);
    expect(store.record$(c)()).toBeUndefined();
    for (const x of [onA, onC, onScreen]) x.stop();
  });

  it('NFR-MNT-006: several changes applied together notify each changed record once', () => {
    const { file, a, c } = fixture();
    const store = new RecordStore(file);
    let both = 0;
    const stop = effect(() => {
      store.record$(a)();
      store.record$(c)();
      both++;
    });
    const rename = (id: RecordId) => ({ ...(store.get(id) as AnyRecord), name: 'x' }) as AnyRecord;
    store.apply([rename(a), rename(c)], []);
    expect(both).toBe(2);
    stop();
  });

  it('records are deep-frozen copies; the input file is untouched', () => {
    const { file, a } = fixture();
    const store = createStore(file);
    const record = store.get(a) as AnyRecord & { transform: object };
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.transform)).toBe(true);
    expect(Object.isFrozen(file.records[a])).toBe(false);
    expect(store.size).toBe(Object.keys(file.records).length);
    expect(store.ids()).toEqual(Object.keys(file.records));
    expect(store.has(a)).toBe(true);
    expect(store.has('nope' as RecordId)).toBe(false);
  });

  it('NFR-MNT-006: an unsubscribed listener hears no later transaction', () => {
    const { file, a } = fixture();
    const store = new RecordStore(file);
    const [kept, dropped]: [string[], string[]] = [[], []];
    store.subscribe((_d, meta) => kept.push(meta.label));
    const unsubscribe = store.subscribe((_d, meta) => dropped.push(meta.label));
    store.transact('one', (tx) => tx.patch(a, { name: '1' }));
    unsubscribe();
    store.transact('two', (tx) => tx.patch(a, { name: '2' }));
    expect([kept, dropped]).toEqual([['one', 'two'], ['one']]);
  });

  it('NFR-MNT-006: refused transactions name their label; the history origins are reserved', () => {
    const { file, a } = fixture();
    for (const origin of ['undo', 'redo'] as const) {
      const store = new RecordStore(file);
      const r = store.transact('replay', (tx) => tx.patch(a, { name: 'x' }), { origin });
      expect(!r.ok && r.error.message.startsWith('replay: ')).toBe(true);
      expect(!r.ok && r.error.diagnostics).toEqual([{ code: 'FLX_ORIGIN_RESERVED', severity: 'error', path: '', message: expect.stringContaining(origin) }]);
      expect(store.get(a)).toEqual(file.records[a]);
    }
    const readOnly = new RecordStore(file, { policy: 'read-only' });
    const refused = readOnly.transact('rename', (tx) => tx.patch(a, { name: 'x' }));
    expect(!refused.ok && refused.error.message.startsWith('rename: ')).toBe(true);
    expect(!refused.ok && refused.error.diagnostics).toEqual([{ code: 'FLX_READ_ONLY', severity: 'error', path: '', message: expect.stringMatching(/\S/) }]);
    const invalid = new RecordStore(file).transact('break', (tx) => tx.patch(a, { transform: 'nope' }));
    expect(!invalid.ok && invalid.error.message.startsWith('break: ')).toBe(true);
  });

  it('NFR-MNT-006: a failed referential check is not remembered as known; a fixed error is forgotten', () => {
    const { file, screen, a } = fixture();
    const store = new RecordStore(file);
    // refused twice: the first refusal does not make its dangling references known
    for (let i = 0; i < 2; i++) expect(store.transact('delete screen', (tx) => tx.delete(screen)).ok).toBe(false);
    // a dangling reference the document had is known; once fixed, bringing it back is new again
    const dangling = new RecordStore({ ...file, records: { ...file.records, [a]: { ...file.records[a], parentId: 'gone' } as AnyRecord } });
    expect(dangling.transact('rename', (tx) => tx.patch(a, { name: 'x' })).ok).toBe(true);
    expect(dangling.transact('fix', (tx) => tx.patch(a, { parentId: undefined })).ok).toBe(true);
    const back = dangling.transact('break again', (tx) => tx.patch(a, { parentId: 'gone' }));
    expect(!back.ok && back.error.diagnostics.map((d) => d.code)).toContain('FLX_REF_MISSING');
  });

  it('NFR-MNT-006: hooks run until no hook writes anything new, even when some of their values repeat', () => {
    const { file, a, c } = fixture();
    const hooks = createRegistry<string, IntegrityHook>('integrityHooks');
    // `a` reacts to `b`'s write, which lands after it in the same pass: it needs a second pass
    hooks.register('a', ({ tx }) => (tx.get(c) as { name?: string }).name === 'b' && tx.patch(a, { name: 'a' }), 'x');
    hooks.register('b', ({ tx }) => tx.patch(c, { name: 'b' }), 'x');
    const store = new RecordStore(file, { hooks });
    const r = store.transact('touch both', (tx) => {
      tx.patch(a, { name: 'start' });
      tx.patch(c, { name: 'start' });
    });
    expect(r.ok, JSON.stringify(!r.ok && r.error)).toBe(true);
    expect([(store.get(a) as { name?: string }).name, (store.get(c) as { name?: string }).name]).toEqual(['a', 'b']);
    // a hook that never settles: the failure names the transaction
    const restless = createRegistry<string, IntegrityHook>('integrityHooks');
    let n = 0;
    restless.register('r', ({ tx }) => tx.patch(a, { name: `n${n++}` }), 'x');
    const depth = new RecordStore(file, { hooks: restless }).transact('spin', (tx) => tx.patch(a, { name: 's' }));
    expect(!depth.ok && depth.error.message.startsWith('spin: ')).toBe(true);
  });

  it('NFR-MNT-006: a record created, dropped and created again in one transaction keeps its children', () => {
    const { file, screen } = fixture();
    const hooks = createRegistry<string, IntegrityHook>('integrityHooks');
    registerCoreHooks(hooks);
    const store = new RecordStore(file, { hooks });
    const group = {
      id: 'GroupGroupGroup1',
      type: 'element',
      kind: 'group',
      screenId: screen,
      index: 'a8',
      transform: { x: 0, y: 0, w: 9, h: 9 },
    } as unknown as AnyRecord;
    const child = {
      id: 'ChildChildChild1',
      type: 'element',
      kind: 'shape',
      defId: 'basic:rect',
      screenId: screen,
      parentId: group.id,
      index: 'a0',
      transform: { x: 0, y: 0, w: 1, h: 1 },
    } as unknown as AnyRecord;
    const r = store.transact('flicker', (tx) => {
      tx.put(group);
      tx.put(child);
      tx.delete(group.id as RecordId);
      tx.put(group);
    });
    expect(r.ok, JSON.stringify(!r.ok && r.error)).toBe(true);
    expect([store.has(group.id as RecordId), store.has(child.id as RecordId)]).toEqual([true, true]);
  });

  it('NFR-MNT-006: a query of ids and has re-runs only when a record is added or removed', () => {
    const { file, a, c } = fixture();
    const store = new RecordStore(file);
    let runs = 0;
    const ids = store.query((v) => {
      runs++;
      return v.ids().length;
    });
    const present = store.query((v) => v.has(c));
    const seen: unknown[] = [];
    const stop = effect(() => {
      seen.push([ids(), present()]);
    });
    store.transact('rename', (tx) => tx.patch(a, { name: 'x' }));
    expect(runs).toBe(1);
    store.transact('delete', (tx) => tx.delete(c));
    expect(runs).toBe(2);
    expect(seen).toEqual([
      [store.size + 1, true],
      [store.size, false],
    ]);
    stop();
  });

  it('toDocument returns the envelope with the current records', () => {
    const { file, c } = fixture();
    const store = new RecordStore(file);
    expect(store.toDocument()).toEqual(file);
    store.apply([], [c]);
    const { [c]: _gone, ...rest } = file.records;
    expect(store.toDocument()).toEqual({ ...file, records: rest });
  });
});
