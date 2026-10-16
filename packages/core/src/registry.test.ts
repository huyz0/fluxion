import { describe, expect, it } from 'vitest';
import { CORE_REGISTRY_NAMES, createCoreRegistries, DESCRIBED_REGISTRY_NAMES } from './core-registries.js';
import { createRegistry, type Registry } from './registry.js';
import { effect } from './signals.js';

describe('registries (03-core-engine §4)', () => {
  it('FR-EXT-001: WHEN a registration is disposed THE SYSTEM SHALL remove it and bump changes$', () => {
    const markers = createRegistry<string, { readonly path: string }>('markers');
    const seen: number[] = [];
    const stop = effect(() => {
      seen.push(markers.changes$());
    });
    const r = markers.register('arrow', { path: 'M0 0' }, 'core');
    expect(r.ok).toBe(true);
    expect(markers.get('arrow')).toEqual({ path: 'M0 0' });
    if (r.ok) r.value.dispose();
    expect(markers.get('arrow')).toBeUndefined();
    expect(markers.list()).toEqual([]);
    expect(seen).toEqual([0, 1, 2]);
    // disposing twice is a no-op, and bumps nothing
    if (r.ok) r.value.dispose();
    expect(seen).toEqual([0, 1, 2]);
    stop();
  });

  it('FR-EXT-001: a duplicate key from another source is a diagnostic', () => {
    const routers = createRegistry<string, string>('routers');
    expect(routers.register('orthogonal', 'core-impl', 'core').ok).toBe(true);
    const clash = routers.register('orthogonal', 'plugin-impl', 'acme');
    expect(clash).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'FLX_REGISTRY_DUPLICATE', severity: 'error', path: '/registries/routers/orthogonal' }),
    });
    // the refusal names the key and suggests a namespaced one
    expect(!clash.ok && clash.error.message).toContain('"orthogonal"');
    expect(!clash.ok && clash.error.hint).toContain('acme:orthogonal');
    // the first registration stays
    expect(routers.get('orthogonal')).toBe('core-impl');
    expect(routers.source('orthogonal')).toBe('core');
  });

  it('the same source may replace its entry; disposing the replaced registration is a no-op', () => {
    const themes = createRegistry<string, number>('themes');
    const first = themes.register('dark', 1, 'acme');
    const second = themes.register('dark', 2, 'acme');
    expect(themes.get('dark')).toBe(2);
    if (first.ok) first.value.dispose();
    expect(themes.get('dark')).toBe(2);
    if (second.ok) second.value.dispose();
    expect(themes.get('dark')).toBeUndefined();
  });

  it('list is sorted by key whatever the registration order', () => {
    const fonts = createRegistry<string, number>('fonts');
    for (const key of ['zeta', 'alpha', 'mid']) fonts.register(key, key.length, 'core');
    expect(fonts.list().map(([k]) => k)).toEqual(['alpha', 'mid', 'zeta']);
  });

  it('FR-EXT-001: the core registries are the 15 named in 03-core-engine §4', () => {
    const regs = createCoreRegistries();
    expect(Object.keys(regs).sort()).toEqual([...CORE_REGISTRY_NAMES].sort());
    expect(CORE_REGISTRY_NAMES).toHaveLength(15);
    for (const name of CORE_REGISTRY_NAMES) expect(regs[name].name).toBe(name);
    // independent instances
    regs.effects.register('x', 1, 'core');
    expect(regs.markers.get('x')).toBeUndefined();
  });
});

describe('registries that require a describe (FR-AI-002)', () => {
  it('FR-AI-002: requireDescribe holds exactly the catalog registries to a describe line, and the others are left alone', () => {
    const registries = createCoreRegistries({ requireDescribe: true });
    for (const name of CORE_REGISTRY_NAMES) {
      const registry = registries[name] as unknown as Registry<string, unknown>;
      const refused = registry.register('probe', { id: 'probe' }, 'test');
      expect([name, !refused.ok]).toEqual([name, DESCRIBED_REGISTRY_NAMES.includes(name)]);
      const described = registry.register('probe2', { id: 'probe2', describe: 'A probe for the test.' }, 'test');
      expect([name, described.ok]).toEqual([name, true]);
    }
  });
});
