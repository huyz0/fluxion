import type { Diagnostic } from '@fluxion/schema';
// Stable codes of the file loader's expected failures and notes (coding-typescript rule 12, ADR-0144). Codes are public API: add, never rename.

/**
 * A stable code for a file that could not be opened (add, never rename).
 *
 * @public
 */
export type FormatErrorCode =
  | 'FILE_NOT_FLUX'
  | 'FILE_ZIP_INVALID'
  | 'FILE_PATH_UNSAFE'
  | 'FILE_DOCUMENT_MISSING'
  | 'FILE_DOCUMENT_INVALID'
  | 'FILE_TOO_LARGE'
  | 'FILE_SHAPE_PACK_INVALID'
  | 'FILE_INTERNAL';

/**
 * An expected failure of opening a file.
 *
 * @public
 */
export type FormatError = {
  /** Stable machine-readable code. */
  readonly code: FormatErrorCode;
  /** One-line developer message. */
  readonly message: string;
  /** Detailed known-data validation paths when available. */
  readonly diagnostics?: readonly Diagnostic[];
};

/**
 * A stable code for something wrong with a file that still opened (add, never rename).
 *
 * @public
 */
export type LoadNoteCode =
  | 'MANIFEST_MISSING'
  | 'MANIFEST_INVALID'
  | 'MIMETYPE_NOT_FIRST'
  | 'ENTRY_HASH_MISMATCH'
  | 'ENTRY_UNLISTED'
  | 'ENTRY_MISSING'
  | 'ASSET_HASH_MISMATCH'
  | 'ASSET_NAME_INVALID'
  | 'ASSET_UNSAFE';

/**
 * A warning about a file that opened: damage or oddness the person may want to know about.
 *
 * @public
 */
export type LoadNote = {
  /** Stable machine-readable code. */
  readonly code: LoadNoteCode;
  /** The entry it is about. */
  readonly entry: string;
  /** One line. */
  readonly message: string;
};
