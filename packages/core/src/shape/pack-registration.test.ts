import { err } from '@fluxion/schema';
import { expect, it } from 'vitest';
import { allowsShapePackContentLicense, createRegistry, registerShapePackSubsets, type ShapeDef } from '../index.js';

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
