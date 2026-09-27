/**
 * A stable geometry error code (add, never rename).
 *
 * @public
 */
export type GeometryErrorCode = 'MATRIX_SINGULAR';

/**
 * An expected failure reported by a geometry function.
 *
 * @public
 */
export type GeometryError = {
  /** Stable machine-readable error code. */
  readonly code: GeometryErrorCode;
  /** Developer-facing description of the failure. */
  readonly message: string;
};

/**
 * Outcome of an operation that can fail for expected reasons: either a value or a {@link GeometryError}.
 *
 * @public
 */
export type Result<T> =
  | {
      /** Discriminant: the operation succeeded. */
      readonly ok: true;
      /** The produced value. */
      readonly value: T;
    }
  | {
      /** Discriminant: the operation failed. */
      readonly ok: false;
      /** Why it failed. */
      readonly error: GeometryError;
    };

/** Wraps a value in a successful {@link Result}. */
export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

/** Builds a failed {@link Result} with the given code and message. */
export function err<T>(code: GeometryErrorCode, message: string): Result<T> {
  return { ok: false, error: { code, message } };
}
