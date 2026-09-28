// Public entry of @fluxion/core; the package comment is the dts banner in tsdown.config.ts.

export type { Random } from '@fluxion/schema';
export type { CoreError, CoreErrorCode } from './errors.js';
export type { Clock, FileIO, FontSpec, Hasher, Logger, LogLevel, TextMeasurer, TextMetrics } from './ports/ports.js';
export { batch, computed, effect, type ReadSignal } from './signals.js';
export { createStore, type Store } from './store.js';

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';
