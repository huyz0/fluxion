import { describe, expect, it } from 'vitest';
import { BASIC_RECT } from './basic-rect.js';
import { builtinRegistries, registerBuiltinViews } from './builtins.js';
import { createRenderRegistries } from './registries.js';
import { ShapeView } from './shape-view.js';

describe('built-in views (FR-EXT-001, ADR-0015 §5)', () => {
  it('FR-EXT-001: the shape view and basic:rect register through the registry API as core', () => {
    const registries = builtinRegistries();
    expect(registries.elementViews.get('shape')?.Component).toBe(ShapeView);
    expect(registries.elementViews.source('shape')).toBe('core');
    expect(registries.shapeDefs.get('basic:rect')).toBe(BASIC_RECT);
    // a plugin that registered first keeps its entry; the built-ins take only the free keys
    const taken = createRenderRegistries();
    const mine = { Component: () => null };
    taken.elementViews.register('shape', mine, 'acme');
    registerBuiltinViews(taken);
    expect(taken.elementViews.get('shape')).toBe(mine);
    expect(taken.shapeDefs.source('basic:rect')).toBe('core');
  });
});
