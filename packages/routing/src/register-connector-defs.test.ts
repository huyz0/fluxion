import { createRegistry } from '@fluxion/core';
import { describe, expect, it } from 'vitest';
import { registerBuiltinRouters } from './builtins.js';
import type { DecoratedRouter } from './decorate.js';
import { registerConnectorDefs } from './register-connector-defs.js';
import type { RouteRequest, Router } from './router.js';

const routers = () => {
  const registry = createRegistry<string, Router>('routers');
  registerBuiltinRouters(registry);
  return registry;
};
const file = (definitions: unknown[]) => ({ format: 'fluxion-connector-defs', formatVersion: '1.0', definitions });
const WAVY = { id: 'lines:wavy', router: 'orthogonal', decoration: { kind: 'wavy', amplitude: 3, wavelength: 12 }, name: 'Wavy' };
const DOUBLE = { id: 'lines:double', router: 'straight', decoration: { kind: 'double', gap: 3 } };
const keys = (r: ReturnType<typeof routers>) => r.list().map(([k]) => k);
const request = (type: RouteRequest['route']['type']): RouteRequest => ({
  source: { point: { x: 0, y: 0 }, dir: { x: 1, y: 0 } },
  target: { point: { x: 200, y: 120 }, dir: { x: -1, y: 0 } },
  route: { type, waypoints: [] },
});

describe('registering a pack connectors.json (FR-CON-010)', () => {
  it('FR-CON-010: WHEN a valid connectors.json loads THE SYSTEM SHALL register each type as a decorated router over its base, removed again on dispose', () => {
    const r = routers();
    const before = keys(r);
    const done = registerConnectorDefs(r, file([WAVY, DOUBLE]), 'lines');
    expect(done.ok).toBe(true);
    const wavy = r.get('lines:wavy') as DecoratedRouter;
    expect(r.source('lines:wavy')).toBe('lines');
    expect(wavy.base).toBe('orthogonal');
    expect(wavy.decoration).toEqual({ kind: 'wavy', amplitude: 3, wavelength: 12 });
    // the route is the base router's; the decoration is drawn over it
    expect(wavy.route(request('lines:wavy'))).toEqual((r.get('orthogonal') as Router).route(request('orthogonal')));
    expect((r.get('lines:double') as DecoratedRouter).base).toBe('straight');
    if (done.ok) done.value.dispose();
    expect(keys(r)).toEqual(before);
  });

  it('FR-CON-010: an invalid connectors.json is refused atomically with FLX_PACK_INVALID and registers nothing', () => {
    for (const bad of [
      file([WAVY, { ...DOUBLE, decoration: { kind: 'spiral', turns: 3 } }]),
      file([WAVY, { ...DOUBLE, id: 'other:double' }]),
      file([WAVY, WAVY]),
      file([]),
      { ...file([WAVY]), formatVersion: '2.0' },
      'not an object',
    ]) {
      const r = routers();
      const before = keys(r);
      const refused = registerConnectorDefs(r, bad, 'lines');
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.error.every((d) => d.code === 'FLX_PACK_INVALID')).toBe(true);
      expect(keys(r)).toEqual(before);
    }
  });

  it('FR-CON-010: an id another source holds or a base router the host lacks refuses the whole file, naming each problem', () => {
    const r = routers();
    r.register('lines:double', r.get('straight') as Router, 'acme');
    const refused = registerConnectorDefs(r, file([WAVY, DOUBLE]), 'lines');
    expect(refused).toEqual({ ok: false, error: [expect.objectContaining({ code: 'FLX_REGISTRY_DUPLICATE', path: '/definitions/1/id' })] });
    expect(r.get('lines:wavy')).toBeUndefined();
    expect(r.source('lines:double')).toBe('acme');

    const bare = createRegistry<string, Router>('routers');
    bare.register('straight', r.get('straight') as Router, 'core');
    const missing = registerConnectorDefs(bare, file([DOUBLE, WAVY]), 'lines');
    expect(missing).toEqual({ ok: false, error: [expect.objectContaining({ code: 'FLX_PACK_INVALID', path: '/definitions/1/router' })] });
    expect(bare.get('lines:double')).toBeUndefined();
  });

  it('FR-CON-010: on a registry that requires describe lines, a describe that is not one catalog line refuses the whole file up front', () => {
    const r = createRegistry<string, Router>('routers', { requireDescribe: true });
    registerBuiltinRouters(r);
    const before = keys(r);
    for (const describe of ['x'.repeat(161), 'two\nlines']) {
      const refused = registerConnectorDefs(r, file([WAVY, { ...DOUBLE, describe }]), 'lines');
      expect(refused).toEqual({ ok: false, error: [expect.objectContaining({ code: 'FLX_PACK_INVALID', path: '/definitions/1/describe' })] });
      expect(keys(r)).toEqual(before);
    }
    // a type without a describe gets its own line, which such a registry takes
    expect(registerConnectorDefs(r, file([WAVY, DOUBLE]), 'lines').ok).toBe(true);
  });

  it('FR-CON-010: the same pack loading its file again replaces its own types', () => {
    const r = routers();
    expect(registerConnectorDefs(r, file([WAVY]), 'lines').ok).toBe(true);
    const again = registerConnectorDefs(r, file([{ ...WAVY, decoration: { kind: 'zigzag', amplitude: 2, wavelength: 8 } }]), 'lines');
    expect(again.ok).toBe(true);
    expect((r.get('lines:wavy') as DecoratedRouter).decoration.kind).toBe('zigzag');
  });

  it('FR-CON-010: a type a newer file drops stays until the earlier registration is disposed (replacement is id by id)', () => {
    const r = routers();
    const first = registerConnectorDefs(r, file([WAVY, DOUBLE]), 'lines');
    expect(registerConnectorDefs(r, file([WAVY]), 'lines').ok).toBe(true);
    expect(r.get('lines:double')).toBeDefined();
    if (first.ok) first.value.dispose();
    expect(r.get('lines:double')).toBeUndefined();
  });
});
