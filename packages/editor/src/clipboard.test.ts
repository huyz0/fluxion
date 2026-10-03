import { createCore, createRegistry } from '@fluxion/core';
import { type Router, registerBuiltinRouters, routeConnector } from '@fluxion/routing';
import { createId, type RecordId, seededRandom } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { registerBuiltinTools } from './builtin-tools.js';
import { copyPayload, createClipboard, PASTE_OFFSET, pasteInto, planPaste } from './clipboard.js';
import { commandMap, dispatchKey, EDITOR_COMMANDS } from './editor-commands.js';
import { DEFAULT_KEYMAP, type KeyPress } from './keymap.js';
import { createSession } from './session.js';
import { createToolDispatcher, createToolRegistry } from './tools.js';

type El = {
  id: RecordId;
  kind: string;
  screenId: RecordId;
  index: string;
  parentId?: RecordId;
  transform?: { x: number; y: number; w: number; h: number };
  freeSource?: { x: number; y: number };
  freeTarget?: { x: number; y: number };
  semantic?: { slug?: string; label?: string };
  route?: { waypoints?: { x: number; y: number }[] };
};

function setup() {
  const b = documentBuilder({ seed: 21 });
  const s = b.screen();
  const a = b.rect(s, { x: 0, y: 0, w: 100, h: 50, slug: 'alpha' });
  const c = b.rect(s, { x: 300, y: 0, w: 100, h: 50 });
  const outside = b.rect(s, { x: 600, y: 300, w: 100, h: 50 });
  const joined = b.connect(a, c);
  const half = b.connect(c, outside);
  const core = createCore(b.build());
  const routers = createRegistry<string, Router>('routers');
  registerBuiltinRouters(routers);
  const route = (id: RecordId) => routeConnector(core.store, { shapeDefs: { get: () => undefined } as never, routers }, id);
  const random = seededRandom(99);
  const newId = () => createId(random);
  return { core, s, a, c, outside, joined, half, route, newId };
}
const rec = (core: ReturnType<typeof setup>['core'], id: RecordId) => core.store.get(id) as unknown as El;
const endPoint = (route: ReturnType<typeof setup>['route']) => (id: RecordId, end: 'source' | 'target') => route(id)?.[end].point;

describe('clipboard (FR-EDT-007)', () => {
  it('FR-EDT-007: a pasted connector stays bound to the pasted shapes, all with fresh ids', () => {
    const { core, s, a, c, joined, route, newId } = setup();
    const before = new Set(core.store.ids());
    const payload = copyPayload(core.store, [a, c, joined], { docId: 'doc', screen: s, endPoint: endPoint(route) });
    expect(payload?.fluxion).toBe('clipboard');
    // two shapes, one connector, its two bindings
    expect(payload?.records.map((r) => r.type).sort()).toEqual(['binding', 'binding', 'element', 'element', 'element']);
    const ids = pasteInto({ view: core.store, execute: core.execute, seal: () => core.store.history.seal(), screen: s, newId }, payload as never, {
      x: 16,
      y: 16,
    });
    expect(ids).toHaveLength(3);
    // all new, none shared with the originals
    const fresh = [...core.store.ids()].filter((id) => !before.has(id));
    expect(fresh).toHaveLength(3 + 2);
    for (const id of ids ?? []) expect(before.has(id)).toBe(false);
    // the pasted connector is bound at both ends, to the pasted shapes
    const pastedConnector = (ids ?? []).find((id) => rec(core, id).kind === 'connector') as RecordId;
    const bindings = core.store
      .members('bindingsByElement', pastedConnector)
      .map((b) => core.store.get(b) as unknown as { connectorId: RecordId; elementId: RecordId; end: string });
    expect(bindings.map((b) => b.end).sort()).toEqual(['source', 'target']);
    const pastedShapes = (ids ?? []).filter((id) => rec(core, id).kind === 'shape');
    expect(bindings.map((b) => b.elementId).sort()).toEqual([...pastedShapes].sort());
    expect(bindings.every((b) => b.connectorId === pastedConnector)).toBe(true);
    // no free point is left on a bound end
    expect(rec(core, pastedConnector).freeSource).toBeUndefined();
    expect(rec(core, pastedConnector).freeTarget).toBeUndefined();
    // offset, in front of the originals, the slug dropped (it names one element)
    const [copyOfA] = pastedShapes.map((id) => rec(core, id)).filter((e) => e.transform?.x === 16);
    expect(copyOfA?.transform).toMatchObject({ x: 16, y: 16, w: 100, h: 50 });
    expect(copyOfA?.semantic?.slug).toBeUndefined();
    expect(rec(core, a).semantic?.slug).toBe('alpha');
    for (const id of ids ?? []) expect(rec(core, id).index > rec(core, a).index).toBe(true);
    // one undo step takes the whole paste away
    core.store.history.undo();
    expect([...core.store.ids()].filter((id) => !before.has(id))).toEqual([]);
  });

  it('FR-EDT-007: a connector end whose shape was not copied is pasted free at the point it had; the end whose shape was copied is bound', () => {
    const { core, s, c, half, route, newId } = setup();
    const payload = copyPayload(core.store, [c, half], { docId: 'doc', screen: s, endPoint: endPoint(route) });
    // c was copied, the far shape was not: only the source binding goes
    expect(payload?.records.filter((r) => r.type === 'binding').map((r) => (r as unknown as { end: string }).end)).toEqual(['source']);
    const ends = route(half) as NonNullable<ReturnType<typeof route>>;
    const plan = planPaste(payload as never, { screen: s, indexes: ['a0', 'a1'], by: { x: 16, y: 16 }, newId });
    const pasted = plan.elements.find((e) => (e as unknown as El).kind === 'connector') as unknown as El;
    expect(plan.bindings).toHaveLength(1);
    // the bound end has a point until its binding is written, as when a connector is made
    expect(pasted.freeSource).toEqual({ x: ends.source.point.x + 16, y: ends.source.point.y + 16 });
    expect(pasted.freeTarget).toEqual({ x: ends.target.point.x + 16, y: ends.target.point.y + 16 });
  });

  it('FR-EDT-007: members keep their copied parent; roots get the given indexes in their own order; a lone member is pasted at the root', () => {
    const b = documentBuilder({ seed: 22 });
    const s = b.screen();
    const g = b.rect(s, { x: 0, y: 0, w: 300, h: 300 });
    const inner = b.rect(s, { x: 10, y: 10, w: 20, h: 20, parentId: g });
    const other = b.rect(s, { x: 500, y: 0, w: 20, h: 20 });
    const core = createCore(b.build());
    const newId = (() => {
      const r = seededRandom(5);
      return () => createId(r);
    })();
    const payload = copyPayload(core.store, [g, other], { docId: 'doc', screen: s });
    const plan = planPaste(payload as never, { screen: s, indexes: ['x1', 'x2'], by: { x: 0, y: 0 }, newId });
    const [pg, pi, po] = plan.elements as unknown as El[];
    expect(pi?.parentId).toBe(pg?.id);
    expect([pg?.index, po?.index]).toEqual(['x1', 'x2']);
    expect(pg?.parentId).toBeUndefined();
    expect(pi?.id).not.toBe(inner);
    // the member alone: its parent was not copied, so it lands on the screen
    const lone = copyPayload(core.store, [inner], { docId: 'doc', screen: s });
    const [only] = planPaste(lone as never, { screen: s, indexes: ['y1'], by: { x: 0, y: 0 }, newId }).elements as unknown as El[];
    expect(only?.parentId).toBeUndefined();
    expect(only?.index).toBe('y1');
    // nothing to copy: no payload
    expect(copyPayload(core.store, [], { docId: 'doc', screen: s })).toBeUndefined();
    expect(copyPayload(core.store, [s, 'gone' as RecordId], { docId: 'doc', screen: s })).toBeUndefined();
    expect(PASTE_OFFSET).toBe(16);
  });

  it('FR-EDT-007: copy, paste, cut and duplicate are keys: repeated pastes step 16 px, a duplicate leaves the clipboard alone', () => {
    const { core, s, a, c, route, newId } = setup();
    const session = createSession('doc');
    const registry = createToolRegistry();
    registerBuiltinTools(registry);
    const tools = createToolDispatcher(registry, {
      session,
      view: core.store,
      execute: core.execute,
      seal: () => core.store.history.seal(),
      newId,
      hitTest: () => undefined,
      elementsIn: () => [],
      screen: s,
      allElements: () => [],
      route,
    });
    const clipboard = createClipboard();
    const key = (k: string) =>
      dispatchKey({ key: k, shift: false, alt: false, mod: true } as KeyPress, DEFAULT_KEYMAP, commandMap(EDITOR_COMMANDS), { mode: 'edit', tools, clipboard });
    const xs = () =>
      [...core.store.ids()]
        .map((id) => rec(core, id))
        .filter((e) => e.kind === 'shape')
        .map((e) => e.transform?.x)
        .sort((p, q) => (p ?? 0) - (q ?? 0));
    // nothing selected: nothing copied, nothing to paste
    expect(key('c')).toBe(false);
    expect(key('v')).toBe(false);
    session.selection.set([a]);
    expect(key('c')).toBe(true);
    expect(clipboard.get()?.records).toHaveLength(1);
    expect(key('v')).toBe(true);
    expect(key('v')).toBe(true);
    // the first paste is 16 px from the original, the next 32
    expect(xs()).toEqual([0, 16, 32, 300, 600]);
    // the paste is selected
    expect(session.selection.get()).toHaveLength(1);
    expect(session.selection.get()[0]).not.toBe(a);
    // a duplicate offsets by 16 from the selection and leaves the clipboard (and its paste count) as they were
    const before = clipboard.get();
    session.selection.set([c]);
    expect(key('d')).toBe(true);
    expect(clipboard.get()).toBe(before);
    expect(xs()).toEqual([0, 16, 32, 300, 316, 600]);
    expect(key('v')).toBe(true);
    expect(xs()).toEqual([0, 16, 32, 48, 300, 316, 600]);
    // cut: copied, then deleted, one undo step each
    session.selection.set([c]);
    expect(key('x')).toBe(true);
    expect(rec(core, c)).toBeUndefined();
    expect(clipboard.get()?.records.length).toBeGreaterThan(0);
    core.store.history.undo();
    expect(rec(core, c)).toBeDefined();
    // without a clipboard (a host that gives none), the keys are not taken
    const bare = dispatchKey({ key: 'c', shift: false, alt: false, mod: true } as KeyPress, DEFAULT_KEYMAP, commandMap(EDITOR_COMMANDS), {
      mode: 'edit',
      tools,
    });
    expect(bare).toBe(false);
  });
});

describe('clipboard order and counting (FR-EDT-007)', () => {
  it('FR-EDT-007: roots keep the order of their fractional indexes, which compare by code unit (aZ before aa)', () => {
    const b = documentBuilder({ seed: 23 });
    const s = b.screen();
    const low = b.rect(s, {});
    const high = b.rect(s, {});
    const doc = b.build();
    const records = { ...doc.records, [low]: { ...(doc.records[low] as object), index: 'aZ' }, [high]: { ...(doc.records[high] as object), index: 'aa' } };
    const core = createCore({ ...doc, records } as typeof doc);
    const random = seededRandom(7);
    const plan = planPaste(copyPayload(core.store, [high, low], { docId: 'd', screen: s }) as never, {
      screen: s,
      indexes: ['n1', 'n2'],
      by: { x: 0, y: 0 },
      newId: () => createId(random),
    });
    // the lower original gets the lower new index
    const byOld = new Map((plan.elements as unknown as El[]).map((e, k) => [k, e.index] as const));
    const order = (copyPayload(core.store, [high, low], { docId: 'd', screen: s })?.records ?? []).map((r) => (r as unknown as El).index);
    expect(order).toEqual(['aa', 'aZ']);
    expect([byOld.get(0), byOld.get(1)]).toEqual(['n2', 'n1']);
  });

  it('FR-EDT-007: a paste that wrote nothing is not counted', () => {
    const clip = createClipboard();
    expect(clip.pastes()).toBe(0);
    clip.countPaste();
    clip.countPaste();
    expect(clip.pastes()).toBe(2);
    clip.set({ fluxion: 'clipboard', version: 1, schemaVersion: '1.2', sourceDocId: 'd', sourceScreen: undefined, records: [], assets: [], bounds: undefined });
    expect(clip.pastes()).toBe(0);
  });
});
