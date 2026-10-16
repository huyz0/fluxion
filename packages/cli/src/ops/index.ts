// The operation layer of the CLI (ADR-0036): each operation is a plain function over file bytes that returns an `OpResult`; a command is a
// thin wrapper (read files, call the operation, write files, map the result to an exit code), and the MCP tools call the same operations
// (M15). Nothing here touches `node:fs`, the process or the console.
import { type Diagnostic, type DocumentFile, parseDocument } from '@fluxion/schema';

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

/**
 * The `validate` operation: parse the text of a document and report every diagnostic. A document with errors fails; one with warnings
 * at most succeeds, and the document comes back with them.
 *
 * @public
 */
export function validateDocument(text: string): OpResult<{ readonly document: DocumentFile; readonly diagnostics: readonly Diagnostic[] }> {
  const r = parseDocument(text);
  if (!r.ok) return opFail(r.error.diagnostics);
  return opOk({ document: r.value.document, diagnostics: r.value.diagnostics }, r.value.diagnostics);
}
