// Stable error codes of geometry's expected failures (coding-typescript rule 12, ADR-0144). Codes are public API: add, never rename.

/**
 * A stable geometry error code (add, never rename).
 *
 * @public
 */
export type GeometryErrorCode = 'MATRIX_SINGULAR' | 'PATH_MISSING_MOVE' | 'PATH_MULTIPLE_SUBPATHS' | 'PATH_COMMAND_AFTER_CLOSE' | 'PATH_INVALID_POINT';

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
