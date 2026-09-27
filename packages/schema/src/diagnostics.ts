// Validation diagnostics (02-document-model §5, FR-DOC-004). Codes are stable public API, listed
// with their meaning in docs/reference/diagnostics.md.

/**
 * How serious a diagnostic is: errors make a document invalid, warnings are kept data the reader
 * does not understand or repaired data, info is advice.
 *
 * @public
 */
export type DiagnosticSeverity = 'error' | 'warning' | 'info';
