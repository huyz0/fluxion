import { describe, expect, it } from 'vitest';
import { CORE_REGISTRY_NAMES, createCoreRegistries } from './core-registries.js';
import { createRegistry } from './registry.js';
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
    regs.markers.register('x', 1, 'core');
    expect(regs.effects.get('x')).toBeUndefined();
  });
});
