// An edge's line jumps through the edit language (M16.35, ADR-0169): `connect` takes `jumps` as the file form does, and an `update` of an
// edge sets or clears them (`default`: a strict patch's null means absent).
import { createCoreRegistries, createStore, type ShapeDef, type Store } from '@fluxion/core';
import { registerBuiltInLayouts } from '@fluxion/layout';
import { describe, expect, it } from 'vitest';
import { compile } from '../compile.js';
import { applyPatchCommand } from './apply.js';

const registries = (() => {
  const r = createCoreRegistries();
  r.shapeDefs.register('basic:rect', { id: 'basic:rect' } as unknown as ShapeDef, 'basic');
  registerBuiltInLayouts(r.layouts);
  return r;
})();
const SOURCE = `flux: 1
title: Jumps
uses: [basic]
screens:
  - id: arch
    nodes:
      web: { shape: rect }
      api: { shape: rect }
    edges:
      - web -> api: { label: calls }
`;
const command = applyPatchCommand(registries);
const fresh = (): Store => createStore(compile(SOURCE, { registries }).doc as never);
const apply = (store: Store, ...ops: unknown[]) => command.run({ store }, { patch: { flux: 1, ops } });
type Connector = { readonly kind: string; readonly route: { readonly type: string; readonly jumps?: string }; readonly labels?: unknown[] };
const connectors = (store: Store) =>
  store
    .members('byType', 'element')
    .map((id) => store.get(id) as unknown as Connector)
    .filter((r) => r.kind === 'connector');

describe('line jumps in the edit language (FR-DSL-001, FR-CON-008)', () => {
  it('FR-CON-008: a patch that adds an edge with jumps: gap gives its connector route.jumps gap', () => {
    const store = fresh();
    const r = apply(store, { op: 'connect', edge: 'api -> web', spec: { route: 'orthogonal', jumps: 'gap' } });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(connectors(store).map((c) => c.route)).toContainEqual({ type: 'orthogonal', jumps: 'gap' });
  });

  it('FR-DSL-001: an update of an edge changes its jumps, and jumps: default clears them, keeping the route type and the label', () => {
    const store = fresh();
    expect(apply(store, { op: 'update', target: 'web->api', set: { jumps: 'arc', route: 'orthogonal' } }).ok).toBe(true);
    expect(connectors(store)[0]?.route).toEqual({ type: 'orthogonal', jumps: 'arc' });
    expect(apply(store, { op: 'update', target: 'web->api', set: { jumps: 'default' } }).ok).toBe(true);
    const [edge] = connectors(store);
    expect(edge?.route).toEqual({ type: 'orthogonal' });
    expect(edge?.labels).toHaveLength(1);
    // both changes are undone as they were made
    expect(store.history.undo().ok).toBe(true);
    expect(connectors(store)[0]?.route.jumps).toBe('arc');
  });

  it('FR-DSL-001: an update of an edge sets the text of its first label where it is, and keeps its other labels', () => {
    const store = fresh();
    const [id] = store.members('byType', 'element').filter((x) => (store.get(x) as unknown as Connector).kind === 'connector');
    const labels = (connectors(store)[0]?.labels ?? []) as { readonly text: unknown }[];
    const second = { text: labels[0]?.text, position: 0.8 };
    expect(store.transact('two labels', (tx) => tx.patch(id as never, { labels: [{ ...labels[0], position: 0.2, offset: { x: 5, y: 0 } }, second] })).ok).toBe(
      true,
    );
    expect(apply(store, { op: 'update', target: 'web->api', set: { label: 'reads' } }).ok).toBe(true);
    const after = connectors(store)[0]?.labels as { readonly text: unknown; readonly position: number; readonly offset?: unknown }[];
    expect(after).toHaveLength(2);
    expect(JSON.stringify(after[0]?.text)).toContain('"reads"');
    expect([after[0]?.position, after[0]?.offset]).toEqual([0.2, { x: 5, y: 0 }]);
    expect(after[1]).toEqual(second);
  });

  it('FR-DSL-001: an edge key of a node and a node key of an edge are refused, naming the key', () => {
    const store = fresh();
    const before = JSON.stringify(store.toDocument());
    const onNode = apply(store, { op: 'update', target: 'web', set: { jumps: 'gap' } });
    expect(onNode.ok).toBe(false);
    expect(JSON.stringify(onNode)).toContain('\\"jumps\\" is not a key of a node');
    const onEdge = apply(store, { op: 'update', target: 'web->api', set: { shape: 'rect' } });
    expect(onEdge.ok).toBe(false);
    expect(JSON.stringify(onEdge)).toContain('\\"shape\\" is not a key of an edge');
    // an edge key that names no edge is refused for that, not for its edge keys
    const unknown = JSON.stringify(apply(store, { op: 'update', target: 'api->web', set: { jumps: 'gap' } }));
    expect(unknown).toContain('no connector runs from');
    expect(unknown).not.toContain('is not a key of');
    expect(JSON.stringify(store.toDocument())).toBe(before);
  });
});
