// Per-user settings (ADR-0029): a port the host implements (the studio on localStorage), so the editor
// never touches a browser global its tests cannot replace.

/**
 * Where the editor keeps per-user settings, JSON by key.
 *
 * @public
 */
export type SettingsStore = {
  /** The value stored under `key`, or undefined. */
  get(key: string): unknown;
  /** Store `value` under `key`. */
  set(key: string, value: unknown): void;
};

/**
 * Settings kept in memory (tests, and hosts without storage).
 *
 * @public
 */
export function memorySettings(initial: { readonly [key: string]: unknown } = {}): SettingsStore {
  const values = new Map<string, unknown>(Object.entries(initial));
  return {
    get: (key) => values.get(key),
    set: (key, value) => {
      values.set(key, value);
    },
  };
}
