// The built-in views (ADR-0015 §5): the shape, connector and image views, registered through the same API as
// plugins (source `core`). Shape definitions come from packs the host registers (ADR-0016, ADR-0017).
import type { Registry, ShapeDef } from '@fluxion/core';
import { ConnectorView } from './connector-view.js';
import { ImageView } from './image-view.js';
import { createRenderRegistries, type RenderRegistries } from './registries.js';
import { ShapeView } from './shape-view.js';

/**
 * Register the built-in views into `registries` (source `core`); a key another source already holds
 * keeps that source's entry.
 *
 * @public
 */
export function registerBuiltinViews(registries: RenderRegistries): void {
  registries.elementViews.register('shape', { Component: ShapeView }, 'core');
  registries.elementViews.register('connector', { Component: ConnectorView }, 'core');
  registries.elementViews.register('image', { Component: ImageView }, 'core');
}

/**
 * Fresh render registries holding the built-in views, reading shape definitions from `shapeDefs` (the
 * host's core registry with its packs; default: none, so every shape is a placeholder).
 *
 * @public
 */
export function builtinRegistries(shapeDefs?: Registry<string, ShapeDef>): RenderRegistries {
  const registries = createRenderRegistries(shapeDefs);
  registerBuiltinViews(registries);
  return registries;
}
