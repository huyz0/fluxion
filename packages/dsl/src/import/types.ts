// The shapes the importers share (ADR-0040, FR-IMP-001): options, the result, and the diagnostics they raise.
import type { DslDiagnostic } from '../types.js';

/**
 * What an importer can be told.
 *
 * @public
 */
export type ImportOptions = {
  /** The deck title; the diagram's own `title` or "Imported diagram" when omitted. */
  readonly title?: string;
  /** The screen id of a single diagram; `diagram` when omitted. */
  readonly screenId?: string;
};

/**
 * What an importer gives back: FluxScript text, or why there is none.
 *
 * @public
 */
export type ImportResult = {
  /** False when any diagnostic is an error. */
  readonly ok: boolean;
  /** The FluxScript file; absent when `ok` is false. */
  readonly flux?: string;
  /** Everything the import skipped, flattened or could not read. */
  readonly diagnostics: readonly DslDiagnostic[];
};
