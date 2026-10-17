// FR-CON-009: a connector end bound to another connector sits at the same fraction of the host's route, and follows it when the host moves.
import { createCore, createRegistry, type ShapeDef } from '@fluxion/core';
import type { Vec2 } from '@fluxion/geometry';
import type { RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { registerBuiltinRouters } from './builtins.js';
import { type RouteContext, routeConnector } from './connector-route.js';
import type { Router } from './router.js';

function context(): RouteContext {
  const routers = createRegistry<string, Router>('routers');
  registerBuiltinRouters(routers);
  return { shapeDefs: createRegistry<string, ShapeDef>('shapeDefs'), routers };
}

/** A straight host from the east of `left` to the west of `right`, and a connector from `other` bound to the host at `fraction`. */
function scene(fraction: number) {
  const b = documentBuilder({ seed: 9 });
  const screen = b.screen();
  const left = b.rect(screen, { x: 0, y: 0, w: 100, h: 100 });
  const right = b.rect(screen, { x: 300, y: 0, w: 100, h: 100 });
  const other = b.rect(screen, { x: 150, y: 300, w: 100, h: 100 });
  const host = b.connect(left, right, { sourceAnchor: { kind: 'named', name: 'e' }, targetAnchor: { kind: 'named', name: 'w' } });
  const link = b.connect(other, host, { sourceAnchor: { kind: 'named', name: 'n' }, targetAnchor: { kind: 'point', x: fraction, y: 0 } });
  return { ...createCore(b.build()), right, host, link };
}

describe('connector to connector binding (FR-CON-009)', () => {
  it('FR-CON-009: an end bound to a connector sits at the path fraction of the host', () => {
    const { store, link } = scene(0.5);
    const route = store.query((v) => routeConnector(v, context(), link))();
    expect(route?.target.point).toEqual({ x: 200, y: 50 });
    expect(route?.source.point).toEqual({ x: 200, y: 300 });
  });

  it('FR-CON-009: another fraction lands further along the host', () => {
    const { store, link } = scene(0.25);
    expect(store.query((v) => routeConnector(v, context(), link))()?.target.point).toEqual({ x: 150, y: 50 });
  });

  it('FR-CON-009: WHEN the host moves THE SYSTEM SHALL move the attached end to the same fraction', () => {
    const { store, link, right } = scene(0.5);
    const routed = store.query((v) => routeConnector(v, context(), link));
    expect(routed()?.target.point).toEqual({ x: 200, y: 50 });
    const done = store.transact('move', (tx) => tx.patch(right, { transform: { x: 500, y: 0, w: 100, h: 100 } }));
    expect(done.ok).toBe(true);
    expect(routed()?.target.point).toEqual({ x: 300, y: 50 });
  });

  it('FR-CON-009: the attached end leaves along the normal of the host', () => {
    const { store, link } = scene(0.5);
    const dir = store.query((v) => routeConnector(v, context(), link))()?.target.dir as Vec2;
    expect(Math.abs(dir.y)).toBe(1);
    expect(dir.x).toBe(0);
  });

  it('FR-CON-009: connectors bound to each other in a ring do not loop', () => {
    const { store, host, link } = scene(0.5);
    const ring = store.transact('ring', (tx) => {
      const bindings = store.members('bindingsByElement', host).map((id) => store.get(id) as { id: RecordId; end: string });
      for (const bnd of bindings) if (bnd.end === 'source') tx.patch(bnd.id, { elementId: link, anchor: { kind: 'point', x: 0.5, y: 0 } });
    });
    expect(ring.ok).toBe(true);
    expect(() => store.query((v) => routeConnector(v, context(), link))()).not.toThrow();
  });
});
