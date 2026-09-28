// Public entry of @fluxion/core; the package comment is the dts banner in tsdown.config.ts.

export type { Random } from '@fluxion/schema';
export { CORE_COMMANDS, registerCoreCommands } from './builtin-commands.js';
export {
  type AnyCommand,
  type ArgsIssue,
  type ArgsParsed,
  type ArgsRejected,
  type ArgsSchema,
  type CommandContext,
  type CommandDef,
  type CommandFailure,
  defineCommand,
  executeCommand,
  type MessageDescriptor,
} from './commands.js';
export { CORE_REGISTRY_NAMES, type CoreRegistries, type CoreRegistryName, createCoreRegistries } from './core-registries.js';
export type { CoreError, CoreErrorCode } from './errors.js';
export { applyFork } from './fork.js';
export type { History } from './history.js';
export { CORE_HOOKS, type HookContext, type IntegrityHook, registerCoreHooks } from './hooks.js';
export type { IndexName } from './indexes.js';
export type { Clock, FileIO, FontSpec, Hasher, Logger, LogLevel, TextMeasurer, TextMetrics } from './ports/ports.js';
export { createRegistry, type Disposable, type PluginId, type Registry } from './registry.js';
export { batch, computed, effect, type ReadSignal } from './signals.js';
export { createStore, type ReadView, type Store, type StoreOptions } from './store.js';
export type { Diff, PutChange, Tx, TxFailure, TxMeta, TxOptions, TxOrigin } from './transaction.js';

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';
