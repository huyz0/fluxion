import { createCore, createRegistry } from '@fluxion/core';
import { connectorDefRouter, type Router, registerBuiltinRouters } from '@fluxion/routing';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { connectorHandlesOf, readRoutes } from './connector-handles.js';

describe('connector handles of pack connector types (FR-CON-007, FR-CON-010)', () => {
  it('FR-CON-007, FR-CON-010: a pack connector type is handled as the router that lays it: segments over orthogonal, tangents over curved', () => {
    const routers = createRegistry<string, Router>('routers');
    registerBuiltinRouters(routers);
    for (const [id, router] of [
      ['lines:wavy', 'orthogonal'],
      ['lines:bow', 'curved'],
    ] as const) {
      const def = connectorDefRouter({ id, router, decoration: { kind: 'wavy', amplitude: 2, wavelength: 12 } }, routers);
      if (def !== undefined) routers.register(id, def, 'lines');
    }
    const handlesOf = (type: string) => {
      const b = documentBuilder({ seed: 20 });
      const s = b.screen();
      const left = b.rect(s, { x: 0, y: 0, w: 100, h: 100 });
      const right = b.rect(s, { x: 400, y: 200, w: 100, h: 100 });
      const line = b.connect(left, right, { route: type as 'orthogonal' });
      const { store } = createCore(b.build());
      return connectorHandlesOf(store, readRoutes(store, { shapeDefs: { get: () => undefined } as never, routers }), line);
    };
    expect(handlesOf('lines:wavy')).toEqual(handlesOf('orthogonal'));
    expect(handlesOf('lines:wavy').some((h) => h.role === 'seg')).toBe(true);
    expect(handlesOf('lines:bow')).toEqual(handlesOf('curved'));
    expect(handlesOf('lines:bow').some((h) => h.role === 'tan')).toBe(true);
  });
});
