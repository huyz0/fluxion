// The built-in views (ADR-0015 §5): the shape, connector and image views, and the built-in routers
// (FR-RTE-001), registered through the same API as plugins (source `core`). Shape definitions come from
// packs the host registers (ADR-0016, ADR-0017).
import type { Registry, ShapeDef } from '@fluxion/core';
import { type Router, registerBuiltinRouters } from '@fluxion/routing';
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
 * Fresh render registries holding the built-in views and routers, reading shape definitions from
 * `shapeDefs` and routers from `routers` (the host's core registries with its packs; default: none, so
 * every shape is a placeholder and only the built-in routers route).
 *
 * @public
 */
export function builtinRegistries(shapeDefs?: Registry<string, ShapeDef>, routers?: Registry<string, Router>): RenderRegistries {
  const registries = createRenderRegistries(shapeDefs, routers);
  registerBuiltinViews(registries);
  registerBuiltinRouters(registries.routers);
  return registries;
}
