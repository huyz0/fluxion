import { type ConnectorDef, createRegistry } from '@fluxion/core';
import { connectorDefRouter, type Router, registerBuiltinRouters } from '@fluxion/routing';
import { elementFields } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { connectorTypeInspectors, packConnectorTypes } from './connector-types.js';

describe('pack connector types in the inspector (FR-CON-010)', () => {
  it('FR-CON-010: the connector inspector lists the registered pack connector types after the built-in routers', () => {
    const routers = createRegistry<string, Router>('routers');
    registerBuiltinRouters(routers);
    const inspectors = connectorTypeInspectors(routers);
    const routeOptions = () => (inspectors.get('connector')?.(elementFields('connector')) ?? []).find((f) => f.path.join('.') === 'route.type')?.options;
    expect(routeOptions()).toEqual(['straight', 'curved', 'orthogonal', 'polyline']);
    // registered later: offered the next time the inspector builds its fields
    for (const id of ['lines:wavy', 'lines:double'] as const) {
      const def: ConnectorDef = { id, router: 'orthogonal', decoration: { kind: 'double', gap: 3 } };
      routers.register(id, connectorDefRouter(def, routers) as Router, 'lines');
    }
    expect(packConnectorTypes(routers)).toEqual(['lines:double', 'lines:wavy']);
    expect(routeOptions()).toEqual(['straight', 'curved', 'orthogonal', 'polyline', 'lines:double', 'lines:wavy']);
    // other kinds and fields are left alone; one object per registry
    expect(inspectors.get('shape')).toBeUndefined();
    expect(connectorTypeInspectors(routers)).toBe(inspectors);
  });
});
