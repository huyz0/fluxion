// The studio's settings (ADR-0029): the editor's SettingsStore on the browser's localStorage, so
// settings such as the panel layout persist per user and browser profile. Storage that is missing,
// full or blocked (private windows, disabled site data) reads as empty and drops writes.
import type { SettingsStore } from '@fluxion/editor';

/** The page's localStorage, or undefined where reading it throws. */
function pageStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Settings kept as JSON in `storage` (default: the page's localStorage).
 *
 * @public
 */
export function localSettings(storage: Storage | undefined = pageStorage()): SettingsStore {
  return {
    get: (key) => {
      try {
        const raw = storage?.getItem(key);
        return raw == null ? undefined : (JSON.parse(raw) as unknown);
      } catch {
        return undefined;
      }
    },
    set: (key, value) => {
      try {
        storage?.setItem(key, JSON.stringify(value));
      } catch {
        // full or blocked storage: the setting lasts this page only
      }
    },
  };
}
