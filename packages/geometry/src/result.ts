// Expected failures are values, not exceptions (coding-typescript rules 10-12). Same shape and
// signatures as @fluxion/schema's Result, so a geometry Result<T> is a schema Result<T, GeometryError>
// (ADR-0144); geometry may not import schema (both are L0), so the shape is repeated here.
import type { GeometryError } from './errors.js';

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
 * Success with a value or failure with an error; geometry functions fail with a {@link GeometryError}.
 *
 * @public
 */
export type Result<T, E = GeometryError> = Ok<T> | Err<E>;

/** Wraps a success value. */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/** Wraps a failure. */
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}
