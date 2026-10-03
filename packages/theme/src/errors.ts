// Stable error codes of theme's expected failures (coding-typescript rule 12, ADR-0144). Codes are public API: add, never rename.

/**
 * A stable theme error code (add, never rename).
 *
 * @public
 */
export type ThemeErrorCode =
  | 'TOKEN_UNKNOWN'
  | 'TOKEN_NOT_A_VALUE'
  | 'THEME_INVALID'
  | 'ROLE_MISSING'
  | 'TOKEN_TYPE'
  | 'TOKEN_CYCLE'
  | 'TOKEN_TRANSFORM'
  | 'FONT_INVALID'
  | 'FONT_DUPLICATE'
  | 'FONT_FORMAT'
  | 'FONT_TOO_LARGE'
  | 'FONT_CORRUPT';

/**
 * An expected failure of token resolution or theme validation.
 *
 * @public
 */
export type ThemeError = {
  /** Stable machine-readable code. */
  readonly code: ThemeErrorCode;
  /** One-line developer message. */
  readonly message: string;
};
