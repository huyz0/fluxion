// Expected failures are values, not exceptions (coding-typescript rules 10-12).
import type { FluxError } from './errors.js';

/**
 * A successful {@link Result}.
 *
 * @public
 */
export type Ok<T> = {
  /** Always `true`. */
  readonly ok: true;
  /** The result value. */
  readonly value: T;
};

/**
 * A failed {@link Result}.
 *
 * @public
 */
export type Err<E> = {
  /** Always `false`. */
  readonly ok: false;
  /** What went wrong. */
  readonly error: E;
};

/**
 * Success with a value or failure with an error.
 *
 * @public
 */
export type Result<T, E = FluxError> = Ok<T> | Err<E>;

/**
 * Wrap a success value.
 *
 * @public
 */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/**
 * Wrap a failure.
 *
 * @public
 */
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}
