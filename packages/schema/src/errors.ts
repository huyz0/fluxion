// Stable error codes of expected failures (coding-typescript rule 12). Codes are public API: add, never rename.

/**
 * A stable, documented error code.
 *
 * @public
 */
export type FluxErrorCode = 'INDEX_INVALID' | 'INDEX_ORDER';

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
