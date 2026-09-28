// One wired core (M3 final F3): the registries with the built-in hooks and commands registered, and
// a store created with those hooks. Tests, render and the CLI start here instead of wiring by hand.
import type { DocumentFile, Result } from '@fluxion/schema';
import { registerCoreCommands } from './builtin-commands.js';
import { type CommandFailure, type CommandTxOptions, executeCommand } from './commands.js';
import { type CoreRegistries, createCoreRegistries } from './core-registries.js';
import { registerCoreHooks } from './hooks.js';
import { createStore, type Store, type StoreOptions } from './store.js';

/**
 * A store and its registries, wired: {@link createCore}'s result.
 *
 * @public
 */
export type Core = {
  /** The document store, created with the `integrityHooks` registry as its hooks. */
  readonly store: Store;
  /** The core registries; `commands` and `integrityHooks` hold the built-ins (source `core`). */
  readonly registries: CoreRegistries;
  /** Run the command `id` against the store ({@link executeCommand} with this core's `commands`). */
  execute(id: string, args: unknown, options?: CommandTxOptions): Result<unknown, CommandFailure>;
};

/**
 * Create a store for `file` with the core registries, the built-in integrity hooks (CORE_HOOKS) and
 * the built-in commands (CORE_COMMANDS) registered. Plugins register into `registries` afterwards;
 * the store reads its hooks registry on every transaction, so later hooks apply too.
 *
 * @public
 */
export function createCore(file: DocumentFile, options: Omit<StoreOptions, 'hooks'> = {}): Core {
  const registries = createCoreRegistries();
  // fresh registries hold nothing, so no built-in can be refused here
  registerCoreHooks(registries.integrityHooks);
  registerCoreCommands(registries.commands);
  const store = createStore(file, { ...options, hooks: registries.integrityHooks });
  return {
    store,
    registries,
    execute: (id, args, options) => executeCommand(registries.commands, options ? { store, options } : { store }, id, args),
  };
}
