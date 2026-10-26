import { createCoreRegistries } from '@fluxion/core';
import { describe, expect, it } from 'vitest';
import { definePack, parseShapePackCategory, parseShapePackIndex } from './index.js';

declare global {
  interface ImportMeta {
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}

const raw = import.meta.glob('../../../fixtures/shape-pack/**/*.json', { query: '?raw', import: 'default', eager: true });
const index = () => JSON.parse(raw['../../../fixtures/shape-pack/index.json'] ?? 'null');
const category = () => JSON.parse(raw['../../../fixtures/shape-pack/categories/basic.json'] ?? 'null');
const policy = (license: string) => license === 'MIT';

describe('declarative pack SDK integration', () => {
  it('FR-LIB-003: SDK validation feeds the existing atomic registration path', () => {
    const metadata = parseShapePackIndex(index(), policy);
    expect(metadata.ok).toBe(true);
    const geometry = parseShapePackCategory(category(), index(), 'basic', policy);
    if (!geometry.ok) throw new Error('valid fixture did not validate');
    const registries = createCoreRegistries();
    const registered = definePack({ id: 'sample', shapes: geometry.value.definitions }).register(registries);
    expect(registered.ok).toBe(true);
    expect(registries.shapeDefs.get('sample:box')).toEqual(geometry.value.definitions[0]);
    expect(registries.shapeDefs.source('sample:triangle')).toBe('sample');
    if (registered.ok) registered.value.dispose();
    expect(registries.shapeDefs.get('sample:box')).toBeUndefined();
    expect(registries.shapeDefs.get('sample:triangle')).toBeUndefined();
  });
  it('NFR-LIC-003: rejected serialized metadata does not register a partial pack', () => {
    const registries = createCoreRegistries();
    const bad = index();
    bad.credits = [];
    const result = parseShapePackCategory(category(), bad, 'basic', policy);
    expect(result.ok).toBe(false);
    if (result.ok) definePack({ id: 'sample', shapes: result.value.definitions }).register(registries);
    expect(registries.shapeDefs.list()).toEqual([]);
  });
});
