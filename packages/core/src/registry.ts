// Typed registries (03-core-engine §4, FR-EXT-001): built-ins and plugins contribute through the
// same API; every extensible kind is looked up here, never switched on.
import { compareKeys, type Diagnostic, err, jsonPointer, ok, type Result } from '@fluxion/schema';
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

/** The longest `describe` line (FR-AI-002): a catalog line must stay short. */
const MAX_DESCRIBE = 160;

/**
 * The one-line description a registered value carries in its `describe` field (FR-AI-002): plain text on one line, at most 160
 * characters. `undefined` when the value has none or it is not such a line.
 *
 * @public
 */
export function describeOf(value: unknown): string | undefined {
  const text = typeof value === 'object' && value !== null ? (value as { readonly describe?: unknown }).describe : undefined;
  if (typeof text !== 'string') return undefined;
  const line = text.trim();
  return line.length > 0 && line.length <= MAX_DESCRIBE && !/[\r\n]/.test(line) ? line : undefined;
}

/**
 * How a registry behaves.
 *
 * @public
 */
export type RegistryOptions = {
  /** Refuse a value with no {@link describeOf} line with `FLX_REGISTRY_UNDESCRIBED` (a dev host's check, FR-AI-002). */
  readonly requireDescribe?: boolean;
};

type Entry<V> = { readonly value: V; readonly source: PluginId };

class MapRegistry<K extends string, V> implements Registry<K, V> {
  readonly name: string;
  readonly #requireDescribe: boolean;
  readonly #entries = new Map<K, Entry<V>>();
  readonly #changes: WritableSignal<number> = writable(0);
  #version = 0;

  constructor(name: string, options: RegistryOptions) {
    this.name = name;
    this.#requireDescribe = options.requireDescribe === true;
  }

  get changes$(): ReadSignal<number> {
    return this.#changes.get;
  }

  register(key: K, value: V, source: PluginId): Result<Disposable, Diagnostic> {
    if (this.#requireDescribe && describeOf(value) === undefined) {
      return err({
        code: 'FLX_REGISTRY_UNDESCRIBED',
        severity: 'error',
        path: jsonPointer(['registries', this.name, key]),
        message: `"${key}" has no one-line describe, which ${this.name} requires`,
        hint: `give ${source}'s "${key}" a describe of one line, at most ${MAX_DESCRIBE} characters`,
      });
    }
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
    // code-unit order, never locale order
    return [...this.#entries].sort(([a], [b]) => compareKeys(a, b)).map(([key, { value }]) => [key, value] as const);
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
export function createRegistry<K extends string, V>(name: string, options: RegistryOptions = {}): Registry<K, V> {
  return new MapRegistry<K, V>(name, options);
}
