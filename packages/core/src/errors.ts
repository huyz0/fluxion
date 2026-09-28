// Stable error codes of core's expected failures (coding-typescript rule 12, ADR-0144). Codes are public API: add, never rename.

/**
 * A stable core error code (add, never rename).
 *
 * @public
 */
export type CoreErrorCode =
  | 'FILE_NOT_FOUND'
  | 'FILE_IO'
  | 'TX_INVALID'
  | 'TX_HOOK_DEPTH'
  | 'TX_READ_ONLY'
  | 'COMMAND_UNKNOWN'
  | 'COMMAND_DISABLED'
  | 'COMMAND_ARGS'
  | 'HISTORY_EMPTY';

/**
 * An expected failure reported by core or one of its ports.
 *
 * @public
 */
export type CoreError = {
  /** Stable machine-readable code. */
  readonly code: CoreErrorCode;
  /** One-line developer message. */
  readonly message: string;
  /** The underlying error or value, when there is one. */
  readonly cause?: unknown;
};
