// The built-in views (ADR-0015 §5): the shape, connector, image, text, group and frame views, the built-in routers
// (FR-RTE-001) and markers (FR-CON-003), registered through the same API as plugins (source `core`). Shape definitions come from
// packs the host registers (ADR-0016, ADR-0017).
import type { MarkerDef, Registry, ShapeDef } from '@fluxion/core';
import { type Router, registerBuiltinRouters } from '@fluxion/routing';
import { ConnectorView } from './connector-view.js';
import { FrameView, GroupView } from './container-views.js';
import { ImageView } from './image-view.js';
import { registerBuiltinMarkers } from './markers.js';
import { createRenderRegistries, type RenderRegistries } from './registries.js';
import { ShapeView } from './shape-view.js';
import { TextView } from './text-view.js';

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
  registries.elementViews.register('text', { Component: TextView }, 'core');
  registries.elementViews.register('group', { Component: GroupView }, 'core');
  registries.elementViews.register('frame', { Component: FrameView }, 'core');
}

/**
 * Fresh render registries holding the built-in views, routers and markers, reading shape definitions
 * from `shapeDefs`, routers from `routers` and markers from `markers` (the host's core registries with
 * its packs; default: none, so every shape is a placeholder and only the built-ins route and mark).
 *
 * @public
 */
export function builtinRegistries(
  shapeDefs?: Registry<string, ShapeDef>,
  routers?: Registry<string, Router>,
  markers?: Registry<string, MarkerDef>,
): RenderRegistries {
  const registries = createRenderRegistries(shapeDefs, routers, markers);
  registerBuiltinViews(registries);
  registerBuiltinRouters(registries.routers);
  registerBuiltinMarkers(registries.markers);
  return registries;
}
