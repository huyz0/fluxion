// Expected failures of the layout pipeline (ADR-0144, coding rule 10): a result, never an exception. The codes are public API: add, never rename.

/**
 * Why a layout request failed.
 *
 * @public
 */
export type LayoutErrorCode =
  /** The input has a duplicate node id, a box or frame that is not finite, or a negative size. */
  | 'LAYOUT_INPUT_INVALID'
  /** The algorithm refused its options. */
  | 'LAYOUT_OPTIONS_INVALID'
  /** The algorithm threw, or returned a box that is not finite. */
  | 'LAYOUT_FAILED'
  /** A worker was asked for an algorithm it has not registered. */
  | 'LAYOUT_ALGORITHM_UNKNOWN';

/**
 * A failed layout request.
 *
 * @public
 */
export type LayoutError = {
  /** What went wrong. */
  readonly code: LayoutErrorCode;
  /** A sentence naming the cause. */
  readonly message: string;
};

/**
 * A success.
 *
 * @public
 */
export type Ok<T> = {
  /** True. */
  readonly ok: true;
  /** The value. */
  readonly value: T;
};

/**
 * A failure.
 *
 * @public
 */
export type Err<E> = {
  /** False. */
  readonly ok: false;
  /** The error. */
  readonly error: E;
};

/**
 * Either a value or why there is none.
 *
 * @public
 */
export type Result<T, E = LayoutError> = Ok<T> | Err<E>;

/**
 * A success.
 *
 * @public
 */
export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
/**
 * A failure.
 *
 * @public
 */
export const err = <E>(error: E): Err<E> => ({ ok: false, error });
