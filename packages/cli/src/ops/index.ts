// The operation layer of the CLI (ADR-0036): each operation is a plain function over file bytes that returns an `OpResult`; a command is a
// thin wrapper (read files, call the operation, write files, map the result to an exit code), and the MCP tools call the same operations
// (M15). Nothing here touches `node:fs`, the process or the console.
import { type Diagnostic, type DocumentFile, parseDocument } from '@fluxion/schema';
import { type OpResult, opFail, opOk } from './result.js';

export { compileDocument } from './compile.js';
export { layoutDocument } from './layout.js';
export { type Linted, lintDocument, wrappedMeasure } from './lint.js';
export { migrateDocument } from './migrate.js';
export { type OpResult, opFail, opOk } from './result.js';

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
