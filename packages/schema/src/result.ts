// Expected failures are values, not exceptions (coding-typescript rules 10-12).

/**
 * A stable, documented error code. Codes are public API; add, never rename.
 *
 * @public
 */
export type FluxErrorCode = 'INDEX_INVALID' | 'INDEX_ORDER' | 'SCHEMA_INVALID' | 'PARSE_JSON' | 'MIGRATION_UNSUPPORTED';

/**
 * An expected failure: stable `code`, developer message, optional JSON pointer and cause.
 *
 * @public
 */
export type FluxError = {
  /** Stable machine-readable code. */
  readonly code: FluxErrorCode;
  /** One-line developer message. */
  readonly message: string;
  /** JSON pointer to the offending value, when there is one. */
  readonly path?: string;
  /** The underlying error or value, when there is one. */
  readonly cause?: unknown;
};

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
