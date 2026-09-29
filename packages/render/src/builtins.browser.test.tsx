import { createRegistry, type ShapeDef } from '@fluxion/core';
import { describe, expect, it } from 'vitest';
import { builtinRegistries, registerBuiltinViews } from './builtins.js';
import { createRenderRegistries } from './registries.js';
import { ShapeView } from './shape-view.js';

describe('built-in views (FR-EXT-001, ADR-0015 §5)', () => {
  it('FR-EXT-001: the shape view registers through the registry API as core; shapes come from the host', () => {
    const registries = builtinRegistries();
    expect(registries.elementViews.get('shape')?.Component).toBe(ShapeView);
    expect(registries.elementViews.source('shape')).toBe('core');
    // render ships no shape definitions (ADR-0016): the host's registry, with its packs, is read
    expect(registries.shapeDefs.list()).toEqual([]);
    const host = createRegistry<string, ShapeDef>('shapeDefs');
    expect(builtinRegistries(host).shapeDefs).toBe(host);
    // a plugin that registered first keeps its entry; the built-ins take only the free keys
    const taken = createRenderRegistries();
    const mine = { Component: () => null };
    taken.elementViews.register('shape', mine, 'acme');
    registerBuiltinViews(taken);
    expect(taken.elementViews.get('shape')).toBe(mine);
    expect(taken.elementViews.source('connector')).toBe('core');
  });
});
