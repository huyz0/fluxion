// The core registries (03-core-engine §4, FR-EXT-001): one typed registry per extension point.
// Its own module, so registry.ts stays a leaf that the store and hooks can import without a cycle.
import type { AnyCommand } from './commands.js';
import type { IntegrityHook } from './hook-types.js';
import { createRegistry, type Registry } from './registry.js';
import type { ShapeDef } from './shape/shape-def.js';

/**
 * The names of the core registries (03-core-engine §4). Value types are opaque here; the packages
 * that consume a registry (render, layout, routing, …) define what they put in it.
 *
 * @public
 */
export const CORE_REGISTRY_NAMES = [
  'elementKinds',
  'shapeDefs',
  'markers',
  'routers',
  'layouts',
  'effects',
  'transitions',
  'themes',
  'fonts',
  'commands',
  'integrityHooks',
  'importers',
  'exporters',
  'dslMacros',
  'lintRules',
] as const;

/**
 * One of {@link CORE_REGISTRY_NAMES}.
 *
 * @public
 */
export type CoreRegistryName = (typeof CORE_REGISTRY_NAMES)[number];

/**
 * The core registries, one per name; values are typed where core consumes them.
 *
 * @public
 */
export type CoreRegistries = {
  readonly [N in CoreRegistryName]: Registry<
    string,
    N extends 'integrityHooks' ? IntegrityHook : N extends 'commands' ? AnyCommand : N extends 'shapeDefs' ? ShapeDef : unknown
  >;
};

/**
 * A fresh set of empty core registries.
 *
 * @public
 */
export function createCoreRegistries(): CoreRegistries {
  return Object.fromEntries(CORE_REGISTRY_NAMES.map((name) => [name, createRegistry<string, unknown>(name)])) as CoreRegistries;
}
