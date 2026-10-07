/**
 * `@fluxion/layout` — Layout interface, built-in algorithms, worker host, constraint/overlap pass, text-measure port.
 *
 * @packageDocumentation
 */
import type { Registry } from '@fluxion/core';
import { stackLayout } from './stack.js';

export { type StackOptions, stackLayout } from './stack.js';
export type { LayoutAlgorithm, LayoutInput, LayoutNode, LayoutOutput, OptionsResult } from './types.js';

/**
 * Register the built-in layouts in a host's `layouts` registry, as source `core` (built-ins use the plugin API, 03 §4).
 *
 * @public
 */
export function registerBuiltInLayouts(layouts: Registry<string, unknown>): ReturnType<Registry<string, unknown>['register']> {
  return layouts.register(stackLayout.id, stackLayout, 'core');
}

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';
