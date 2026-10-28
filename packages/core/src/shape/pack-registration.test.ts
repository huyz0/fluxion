import { err } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import {
  type ArtworkFontBinding,
  allowsShapePackContentLicense,
  artworkFontAlias,
  artworkFontRequirements,
  checkVersionedShapePackSubsets,
  createRegistry,
  parseVersionedShapePackSubset,
  registerShapePackSubsets,
  registerVersionedShapePackSubsets,
  type ShapeDef,
} from '../index.js';

const files = import.meta.glob('../../../../fixtures/shape-pack/subset.json', { query: '?raw', import: 'default', eager: true });
const subset = () => JSON.parse(Object.values(files)[0] ?? 'null');
const registry = () => createRegistry<string, ShapeDef>('shapes');
const policy = allowsShapePackContentLicense;

it('FR-LIB-009: saved subsets register their geometry and dispose only their document-owned definitions', () => {
  const target = registry();
  const pack = subset();
  const registered = registerShapePackSubsets(target, [pack], policy);
  expect(registered.ok).toBe(true);
  expect(target.list().map(([id]) => id)).toEqual(['sample:box', 'sample:triangle']);
  expect(target.get('sample:box')).toEqual(pack.definitions[0]);
  expect(target.source('sample:box')).toBe('sample');
  if (!registered.ok) throw new Error('registration failed');
  registered.value.dispose();
  registered.value.dispose();
  expect(target.list()).toEqual([]);
});

it('FR-LIB-009 NFR-SEC-001: invalid later data, duplicate namespaces and denied rights leave no partial registration', () => {
  for (const inputs of [
    [subset(), { ...subset(), formatVersion: '2.0' }],
    [subset(), subset()],
  ]) {
    const target = registry();
    expect(registerShapePackSubsets(target, inputs, policy).ok).toBe(false);
    expect(target.list()).toEqual([]);
  }
  const target = registry();
  expect(registerShapePackSubsets(target, [subset()], () => false).ok).toBe(false);
  expect(target.list()).toEqual([]);
});

it('FR-LIB-009: an occupied namespace with the same source or disjoint IDs cannot mix installed and saved versions', () => {
  for (const id of ['sample:box', 'sample:other']) {
    for (const source of ['sample', 'installed']) {
      const target = registry();
      const existing = { ...subset().definitions[0], id };
      expect(target.register(id, existing, source).ok).toBe(true);
      const before = target.list();
      expect(registerShapePackSubsets(target, [{ ...subset(), version: '2.0.0' }], policy).ok).toBe(false);
      expect(target.list()).toEqual(before);
      expect(target.get(id)).toBe(existing);
    }
  }
});

it('FR-LIB-009: a registry refusal after the first insertion rolls back newly registered geometry', () => {
  const target = registry();
  const failing = new Proxy(target, {
    get(object, key) {
      if (key === 'register')
        return (id: string, value: ShapeDef, source: string) =>
          id === 'sample:triangle'
            ? err({ code: 'FLX_REGISTRY_DUPLICATE' as const, severity: 'error' as const, path: '/registry', message: 'refused' })
            : object.register(id, value, source);
      const value = Reflect.get(object, key, object);
      return typeof value === 'function' ? value.bind(object) : value;
    },
  });
  expect(registerShapePackSubsets(failing, [subset()], policy).ok).toBe(false);
  expect(target.list()).toEqual([]);
});

describe('FR-LIB-004 FR-AST-003: versioned registration binds exact artwork fonts (M18.97)', () => {
  const v11Files = import.meta.glob('../../../../fixtures/shape-pack/v1.1/subset.json', { query: '?raw', import: 'default', eager: true });
  const v11 = () => JSON.parse(Object.values(v11Files)[0] ?? 'null');
  const SHA = '8909904ab6c872eb994093482a88a28eca2cd95912d7b6fecd72103b0dc07edc';
  const registries = () => ({ shapeDefs: registry(), artworkFonts: createRegistry<string, readonly ArtworkFontBinding[]>('artworkFonts') });

  it('lists each bound byte identity once, with its private alias', () => {
    const parsed = parseVersionedShapePackSubset(v11(), policy);
    if (!parsed.ok) throw new Error('fixture');
    const other = { ...v11(), id: 'other', definitions: v11().definitions.map((d: ShapeDef) => ({ ...d, id: d.id.replace('sample:', 'other:') })) };
    other.definitionFonts = [{ definitionId: 'other:label', faceIds: ['inter'] }];
    other.fontCredits = other.fontCredits.map((c: { definitionIds: string[] }) => ({ ...c, definitionIds: ['other:label'] }));
    const second = parseVersionedShapePackSubset(other, policy);
    if (!second.ok) throw new Error(JSON.stringify(second.error));
    const legacy = parseVersionedShapePackSubset(subset(), policy);
    if (!legacy.ok) throw new Error('fixture');
    expect(artworkFontRequirements([parsed.value, second.value, legacy.value])).toEqual([
      { sha256: SHA, size: 23664, weight: 400, style: 'normal', alias: artworkFontAlias(SHA) },
    ]);
  });

  it('registers canonical geometry and renderer bindings, and disposes both', () => {
    const target = registries();
    const done = registerVersionedShapePackSubsets(target, [v11(), subset2()], policy, new Set([SHA]));
    if (!done.ok) throw new Error(JSON.stringify(done.error));
    expect(target.shapeDefs.get('sample:label')).toEqual(v11().definitions[1]);
    expect(target.artworkFonts.get('sample:label')).toEqual([{ family: 'Inter', weight: 400, style: 'normal', sha256: SHA, alias: artworkFontAlias(SHA) }]);
    expect(target.artworkFonts.get('sample:box')).toBeUndefined();
    expect(target.shapeDefs.get('legacy:box')).toBeDefined();
    done.value.dispose();
    expect([target.shapeDefs.list(), target.artworkFonts.list()]).toEqual([[], []]);
  });

  it('refuses everything when a bound font is not registered, so its text never falls back', () => {
    const target = registries();
    const done = registerVersionedShapePackSubsets(target, [subset2(), v11()], policy, new Set());
    expect(done.ok).toBe(false);
    if (!done.ok) expect(done.error[0]?.message).toMatch(/artwork font 8909904a.* is not registered/);
    expect([target.shapeDefs.list(), target.artworkFonts.list()]).toEqual([[], []]);
  });

  it('rolls back geometry when a binding cannot be registered', () => {
    const target = registries();
    target.artworkFonts.register('sample:label', [], 'elsewhere');
    expect(registerVersionedShapePackSubsets(target, [v11()], policy, new Set([SHA])).ok).toBe(false);
    expect(target.shapeDefs.list()).toEqual([]);
    expect(target.artworkFonts.list().map(([id]) => id)).toEqual(['sample:label']);
  });

  it('checks subsets without effects: parsed under the policy, namespaces free, malformed input is diagnostics (M18.115)', () => {
    const target = registries();
    const checked = checkVersionedShapePackSubsets(target.shapeDefs, [v11(), subset2()], policy);
    expect(checked.ok && checked.value.map((p) => [p.id, p.formatVersion])).toEqual([
      ['sample', '1.1'],
      ['legacy', '1.0'],
    ]);
    expect(checkVersionedShapePackSubsets(target.shapeDefs, [v11()], () => false).ok).toBe(false);
    expect(checkVersionedShapePackSubsets(target.shapeDefs, [v11(), v11()], policy).ok).toBe(false);
    expect(checkVersionedShapePackSubsets(target.shapeDefs, [{ ...v11(), fontResources: 'none' }], policy).ok).toBe(false);
    expect(checkVersionedShapePackSubsets(target.shapeDefs, 'none' as never, policy).ok).toBe(false);
    target.shapeDefs.register('sample:other', v11().definitions[0], 'installed');
    expect(checkVersionedShapePackSubsets(target.shapeDefs, [v11()], policy).ok).toBe(false);
    expect(target.artworkFonts.list()).toEqual([]);
  });

  it('keeps the 1.0-only path refusing 1.1 subsets', () => {
    const target = registry();
    expect(registerShapePackSubsets(target, [v11()], policy).ok).toBe(false);
    expect(target.list()).toEqual([]);
  });
});

/** The 1.0 fixture under another namespace, to mix versions in one registration. */
function subset2() {
  const pack = subset();
  return { ...pack, id: 'legacy', definitions: pack.definitions.map((d: ShapeDef) => ({ ...d, id: d.id.replace('sample:', 'legacy:') })) };
}
