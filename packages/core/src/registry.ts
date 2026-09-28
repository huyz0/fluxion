// Typed registries (03-core-engine §4, FR-EXT-001): built-ins and plugins contribute through the
// same API; every extensible kind is looked up here, never switched on.
import { type Diagnostic, err, jsonPointer, ok, type Result } from '@fluxion/schema';
import type { IntegrityHook } from './hook-types.js';
import { type ReadSignal, type WritableSignal, writable } from './signals.js';

/**
 * The id of whoever registered something: a plugin id, or `core` for built-ins.
 *
 * @public
 */
export type PluginId = string;

/**
 * Undoes a registration. Idempotent.
 *
 * @public
 */
export type Disposable = {
  /** Remove what was registered (no-op when already removed or replaced). */
  dispose(): void;
};

/**
 * A typed map of contributions keyed by name.
 *
 * @public
 */
export interface Registry<K extends string, V> {
  /** The registry's name, used in diagnostic paths. */
  readonly name: string;
  /**
   * Add `value` under `key` for `source`. The same source may replace its own entry; a key held by
   * another source is refused with `FLX_REGISTRY_DUPLICATE` and the existing entry stays.
   */
  register(key: K, value: V, source: PluginId): Result<Disposable, Diagnostic>;
  /** The value under `key`. */
  get(key: K): V | undefined;
  /** Who registered `key`. */
  source(key: K): PluginId | undefined;
  /** Every entry, sorted by key (deterministic whatever the load order). */
  list(): ReadonlyArray<readonly [K, V]>;
  /** A counter that changes on every registration and disposal; read it to react to changes. */
  readonly changes$: ReadSignal<number>;
}

type Entry<V> = { readonly value: V; readonly source: PluginId };

class MapRegistry<K extends string, V> implements Registry<K, V> {
  readonly name: string;
  readonly #entries = new Map<K, Entry<V>>();
  readonly #changes: WritableSignal<number> = writable(0);
  #version = 0;

  constructor(name: string) {
    this.name = name;
  }

  get changes$(): ReadSignal<number> {
    return this.#changes.get;
  }

  register(key: K, value: V, source: PluginId): Result<Disposable, Diagnostic> {
    const held = this.#entries.get(key);
    if (held && held.source !== source) {
      return err({
        code: 'FLX_REGISTRY_DUPLICATE',
        severity: 'error',
        path: jsonPointer(['registries', this.name, key]),
        message: `"${key}" is already registered in ${this.name} by ${held.source}; ${source}'s registration was refused`,
        hint: `namespace the key, e.g. "${source}:${key}"`,
      });
    }
    const entry: Entry<V> = { value, source };
    this.#entries.set(key, entry);
    this.#bump();
    return ok({
      dispose: () => {
        // only the registration that is still current is removed; a replaced one is a no-op
        if (this.#entries.get(key) !== entry) return;
        this.#entries.delete(key);
        this.#bump();
      },
    });
  }

  get(key: K): V | undefined {
    return this.#entries.get(key)?.value;
  }

  source(key: K): PluginId | undefined {
    return this.#entries.get(key)?.source;
  }

  list(): ReadonlyArray<readonly [K, V]> {
    return [...this.#entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, { value }]) => [key, value] as const);
  }

  #bump(): void {
    this.#changes.set(++this.#version);
  }
}

/**
 * An empty registry named `name`.
 *
 * @public
 */
export function createRegistry<K extends string, V>(name: string): Registry<K, V> {
  return new MapRegistry<K, V>(name);
}

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
export type CoreRegistries = { readonly [N in CoreRegistryName]: Registry<string, N extends 'integrityHooks' ? IntegrityHook : unknown> };

/**
 * A fresh set of empty core registries.
 *
 * @public
 */
export function createCoreRegistries(): CoreRegistries {
  return Object.fromEntries(CORE_REGISTRY_NAMES.map((name) => [name, createRegistry<string, unknown>(name)])) as CoreRegistries;
}
