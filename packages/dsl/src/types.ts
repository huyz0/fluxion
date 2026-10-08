// The compiler's public shapes (06-ai-authoring.md §3, ADR-0030, ADR-0031). The `Diagnostic` of `@fluxion/schema` is the only error
// shape (02 §5); a FluxScript diagnostic adds the source range it points at.
import type { CoreRegistries, SyncHash128 } from '@fluxion/core';
import type { Diagnostic, DiagnosticCode, DocumentFile, RecordId } from '@fluxion/schema';
import type { DslCode } from './diagnostics/codes.js';

/**
 * A span of FluxScript source: 1-based line and column of its start and end, and 0-based character offsets.
 *
 * @public
 */
export type SourceRange = {
  /** Line of the first character (1-based). */
  readonly line: number;
  /** Column of the first character (1-based). */
  readonly col: number;
  /** Line after the last character. */
  readonly endLine: number;
  /** Column after the last character. */
  readonly endCol: number;
  /** Offset of the first character. */
  readonly offset: number;
  /** Offset after the last character. */
  readonly end: number;
};

/**
 * A diagnostic of a FluxScript compile: a FluxScript code or a schema code it shares, and the source range it points at.
 *
 * @public
 */
export type DslDiagnostic = Omit<Diagnostic, 'code'> & {
  /** A FluxScript code (`codes.ts`) or a schema code. */
  readonly code: DslCode | DiagnosticCode;
  /** Where in the source, when the problem has a place there. */
  readonly source?: SourceRange;
};

/**
 * How to compile FluxScript.
 *
 * @public
 */
export type CompileOptions = {
  /** The registries shapes, layouts and packs are looked up in. */
  readonly registries: CoreRegistries;
  /** The stable-id hash (ADR-0031); the SHA-256 one when omitted. */
  readonly hasher?: SyncHash128;
  /** The id salt of a first compile (ADR-0031); a base document's kept salt wins. */
  readonly salt?: string;
  /** `strict` (default) or `lenient`: lenient applies auto-fixes and downgrades them to warnings. */
  readonly mode?: 'strict' | 'lenient';
  /** The document a screen is compiled into. R2 reads its kept salt (ADR-0031); the upsert of a screen into it is M12.18. */
  readonly base?: DocumentFile;
};

/**
 * What a compile gives back.
 *
 * @public
 */
export type CompileResult = {
  /** The document; absent only when a fatal problem blocks everything. */
  readonly doc?: DocumentFile;
  /** Every problem, ranked by the formatter only when shown. */
  readonly diagnostics: readonly DslDiagnostic[];
  /** Where each record came from (the Source view, FR-EDT-022). */
  readonly sourceMap: ReadonlyMap<RecordId, SourceRange>;
  /** Counts. */
  readonly stats: {
    /** Screens compiled. */
    readonly screens: number;
    /** Records in the document. */
    readonly records: number;
  };
};
