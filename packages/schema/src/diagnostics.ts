// Validation diagnostics (02-document-model §5, FR-DOC-004). Codes are stable public API: add,
// never rename; each is described in docs/reference/diagnostics.md.

/**
 * How serious a diagnostic is: errors make a document invalid, warnings mark data this version
 * keeps but does not understand (or repaired), info is advice.
 *
 * @public
 */
export type DiagnosticSeverity = 'error' | 'warning' | 'info';

/**
 * A stable diagnostic code (see {@link DIAGNOSTIC_CODES}).
 *
 * @public
 */
export type DiagnosticCode =
  | 'FLX_JSON_INVALID'
  | 'FLX_JSON_TOO_DEEP'
  | 'FLX_DOC_NOT_OBJECT'
  | 'FLX_VERSION_INVALID'
  | 'FLX_VERSION_UNSUPPORTED'
  | 'FLX_VERSION_NEWER'
  | 'FLX_RECORDS_INVALID'
  | 'FLX_SCHEMA_INVALID'
  | 'FLX_ID_MISMATCH'
  | 'FLX_RECORD_UNKNOWN_TYPE'
  | 'FLX_KIND_UNKNOWN'
  | 'FLX_TEXT_INVALID'
  | 'FLX_TEXT_UNSAFE_LINK'
  | 'FLX_TEXT_UNKNOWN_NODE'
  | 'FLX_TEXT_UNKNOWN_MARK'
  | 'FLX_DOCUMENT_MISSING'
  | 'FLX_DOCUMENT_DUPLICATE'
  | 'FLX_REF_MISSING'
  | 'FLX_REF_WRONG_TYPE'
  | 'FLX_PARENT_INVALID'
  | 'FLX_PARENT_CYCLE'
  | 'FLX_BINDING_DUPLICATE'
  | 'FLX_CONNECTOR_END_MISSING'
  | 'FLX_CONNECTOR_END_CONFLICT'
  | 'FLX_INDEX_DUPLICATE'
  | 'FLX_SLUG_DUPLICATE'
  | 'FLX_REPAIRED_BINDING'
  | 'FLX_REPAIRED_PARENT'
  | 'FLX_REPAIRED_INDEX'
  | 'FLX_REGISTRY_DUPLICATE'
  | 'FLX_COMMAND_UNKNOWN'
  | 'FLX_COMMAND_DISABLED'
  | 'FLX_COMMAND_ARGS';

/**
 * Every diagnostic code with the severity it is reported at (the mapped type makes the list
 * complete).
 *
 * @public
 */
export const DIAGNOSTIC_CODES: { readonly [C in DiagnosticCode]: DiagnosticSeverity } = {
  FLX_JSON_INVALID: 'error',
  FLX_JSON_TOO_DEEP: 'error',
  FLX_DOC_NOT_OBJECT: 'error',
  FLX_VERSION_INVALID: 'error',
  FLX_VERSION_UNSUPPORTED: 'error',
  FLX_VERSION_NEWER: 'warning',
  FLX_RECORDS_INVALID: 'error',
  FLX_SCHEMA_INVALID: 'error',
  FLX_ID_MISMATCH: 'error',
  FLX_RECORD_UNKNOWN_TYPE: 'warning',
  FLX_KIND_UNKNOWN: 'warning',
  FLX_TEXT_INVALID: 'error',
  FLX_TEXT_UNSAFE_LINK: 'error',
  FLX_TEXT_UNKNOWN_NODE: 'warning',
  FLX_TEXT_UNKNOWN_MARK: 'warning',
  FLX_DOCUMENT_MISSING: 'error',
  FLX_DOCUMENT_DUPLICATE: 'error',
  FLX_REF_MISSING: 'error',
  FLX_REF_WRONG_TYPE: 'error',
  FLX_PARENT_INVALID: 'error',
  FLX_PARENT_CYCLE: 'error',
  FLX_BINDING_DUPLICATE: 'error',
  FLX_CONNECTOR_END_MISSING: 'error',
  FLX_CONNECTOR_END_CONFLICT: 'warning',
  FLX_INDEX_DUPLICATE: 'warning',
  FLX_SLUG_DUPLICATE: 'error',
  FLX_REPAIRED_BINDING: 'warning',
  FLX_REPAIRED_PARENT: 'warning',
  FLX_REPAIRED_INDEX: 'warning',
  FLX_REGISTRY_DUPLICATE: 'error',
  FLX_COMMAND_UNKNOWN: 'error',
  FLX_COMMAND_DISABLED: 'error',
  FLX_COMMAND_ARGS: 'error',
};

/**
 * One problem found in a document: stable code, severity, JSON pointer, one-line message, and a
 * concrete fix when there is one.
 *
 * @public
 */
export type Diagnostic = {
  /** Stable code, documented in docs/reference/diagnostics.md. */
  readonly code: DiagnosticCode;
  /** How serious it is. */
  readonly severity: DiagnosticSeverity;
  /** JSON pointer (RFC 6901) to the value, e.g. `/records/e1/style/fill`. */
  readonly path: string;
  /** One line, readable by people and language models. */
  readonly message: string;
  /** A concrete fix, e.g. `did you mean "basic:rounded-rect"?`. */
  readonly hint?: string;
};

/**
 * A JSON pointer (RFC 6901) from path segments: `~` and `/` in segments are escaped.
 *
 * @public
 */
export function jsonPointer(segments: readonly (string | number)[]): string {
  return segments.map((s) => `/${String(s).replace(/~/g, '~0').replace(/\//g, '~1')}`).join('');
}

/** Build a diagnostic with the severity its code carries. */
export function diagnostic(code: DiagnosticCode, path: readonly (string | number)[], message: string, hint?: string): Diagnostic {
  const d = { code, severity: DIAGNOSTIC_CODES[code], path: jsonPointer(path), message };
  return hint === undefined ? d : { ...d, hint };
}
