// The built-in views of R0 (ADR-0015 §5): the shape view and the `basic:rect` outline, registered
// through the same API as plugins (source `core`). The basic pack takes the shapes over in M5.
import { BASIC_RECT } from './basic-rect.js';
import { createRenderRegistries, type RenderRegistries } from './registries.js';
import { ShapeView } from './shape-view.js';

/**
 * Register the built-in views and outlines into `registries` (source `core`); a key another source
 * already holds keeps that source's entry.
 *
 * @public
 */
export function registerBuiltinViews(registries: RenderRegistries): void {
  registries.elementViews.register('shape', { Component: ShapeView }, 'core');
  registries.shapeDefs.register('basic:rect', BASIC_RECT, 'core');
}

/**
 * Fresh render registries holding the built-ins.
 *
 * @public
 */
export function builtinRegistries(): RenderRegistries {
  const registries = createRenderRegistries();
  registerBuiltinViews(registries);
  return registries;
}
