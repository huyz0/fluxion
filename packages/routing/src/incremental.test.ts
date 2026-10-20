// FR-RTE-002: a move reroutes only the connectors the bindings index names.
import { createCore, createRegistry, type ShapeDef } from '@fluxion/core';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { registerBuiltinRouters } from './builtins.js';
import type { RouteContext } from './connector-route.js';
import { affectedConnectors, rerouteAffected } from './incremental.js';
import type { Router } from './router.js';

function context(seen: Array<string | undefined> = []): RouteContext {
  const routers = createRegistry<string, Router>('routers');
  registerBuiltinRouters(routers);
  routers.register(
    'test:spy',
    {
      route: (r) => (
        seen.push(r.quality),
        [
          { kind: 'M', to: r.source.point },
          { kind: 'L', to: r.target.point },
        ]
      ),
    },
    'test',
  );
  return { shapeDefs: createRegistry<string, ShapeDef>('shapeDefs'), routers };
}

function scene() {
  const b = documentBuilder({ seed: 3 });
  const screen = b.screen();
  const box = (k: number) => b.rect(screen, { x: 200 * k, y: 0, w: 100, h: 100 });
  const [a, c, d, e] = [box(0), box(1), box(2), box(3)];
  const ac = b.connect(a, c, { route: 'test:spy' });
  const cd = b.connect(c, d, { route: 'test:spy' });
  const de = b.connect(d, e, { route: 'test:spy' });
  const onHost = b.connect(e as never, ac, { route: 'test:spy' });
  return { ...createCore(b.build()), a, c, e, ac, cd, de, onHost };
}

describe('incremental rerouting (FR-RTE-002)', () => {
  it('FR-RTE-002: the connectors bound to a moved element are the affected ones, with those on them', () => {
    const { store, a, ac, onHost, de, e } = scene();
    expect(store.query((v) => affectedConnectors(v, [a]))()).toEqual([ac, onHost].sort());
    expect(store.query((v) => affectedConnectors(v, [e]))()).toEqual([de, onHost].sort());
    expect(store.query((v) => affectedConnectors(v, []))()).toEqual([]);
  });

  it('FR-RTE-002: only the affected connectors are routed, by the cheap pass unless asked for the full one', () => {
    const seen: Array<string | undefined> = [];
    const { store, a, ac } = scene();
    const cheap = store.query((v) => rerouteAffected(v, context(seen), [a]))();
    expect([...cheap.keys()].sort()).toContain(ac);
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set(['cheap']));
    seen.length = 0;
    store.query((v) => rerouteAffected(v, context(seen), [a], 'full'))();
    expect(new Set(seen)).toEqual(new Set(['full']));
  });

  it('FR-RTE-002: a connector nothing bound to the moved element touches is not routed', () => {
    const { store, c, cd, de } = scene();
    const routes = store.query((v) => rerouteAffected(v, context(), [c]))();
    expect(routes.has(de)).toBe(false);
    expect(routes.has(cd)).toBe(true);
  });
});
