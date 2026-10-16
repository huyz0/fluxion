// What an operation returns (ADR-0036): a value with the notes it made, or the diagnostics that made it fail.
import type { Diagnostic } from '@fluxion/schema';

/**
 * What an operation returns: a value with the notes it made (warnings and infos), or the diagnostics that made it fail.
 *
 * @public
 */
export type OpResult<T> =
  | {
      /** The operation succeeded. */
      readonly ok: true;
      /** The value that becomes the reply's `result`. */
      readonly value: T;
      /** Warnings and infos; the reply carries them beside the result. */
      readonly diagnostics: readonly Diagnostic[];
    }
  | {
      /** The operation failed. */
      readonly ok: false;
      /** Why; at least one error. */
      readonly diagnostics: readonly Diagnostic[];
    };

/**
 * A successful operation.
 *
 * @public
 */
export const opOk = <T>(value: T, diagnostics: readonly Diagnostic[] = []): OpResult<T> => ({ ok: true, value, diagnostics });

/**
 * A failed operation.
 *
 * @public
 */
export const opFail = (diagnostics: readonly Diagnostic[]): OpResult<never> => ({ ok: false, diagnostics });
