// Test helper: a key press as the editor's window dispatcher handles it (editor-keys.tsx), through the
// default keymap and the tools' shortcut bindings, without the DOM (M7.4).
import { commandMap, dispatchKey } from '../editor-commands.js';
import { DEFAULT_KEYMAP, type KeyPress, toolBindings } from '../keymap.js';
import type { ToolDispatcher } from '../tools.js';

/** Press `k` for `tools` while editing; true when a command or the current state took it. */
export function press(tools: ToolDispatcher, k: KeyPress): boolean {
  return dispatchKey(k, [...DEFAULT_KEYMAP, ...toolBindings(tools.list())], commandMap(), { mode: 'edit', tools });
}
