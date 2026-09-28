// Public entry of @fluxion/core; the package comment is the dts banner in tsdown.config.ts.

export type { Random } from '@fluxion/schema';
export type { CoreError, CoreErrorCode } from './errors.js';
export type { IndexName } from './indexes.js';
export type { Clock, FileIO, FontSpec, Hasher, Logger, LogLevel, TextMeasurer, TextMetrics } from './ports/ports.js';
export {
  CORE_REGISTRY_NAMES,
  type CoreRegistries,
  type CoreRegistryName,
  createCoreRegistries,
  createRegistry,
  type Disposable,
  type PluginId,
  type Registry,
} from './registry.js';
export { batch, computed, effect, type ReadSignal } from './signals.js';
export { createStore, type ReadView, type Store, type StoreOptions } from './store.js';
export type { Diff, PutChange, Tx, TxFailure, TxMeta, TxOptions, TxOrigin } from './transaction.js';

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';
