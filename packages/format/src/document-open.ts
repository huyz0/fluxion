// Opening the text of `document.json` as a document, as far as it can be opened (FR-FIL-009, NFR-PORT-003, NFR-REL-002): in full when it is
// valid; salvaged when it has invalid records (they are dropped and listed) or is cut off (the records before the cut are kept); and
// read-only when it names a newer major version (read as the current schema, never saved back).
import { type Diagnostic, type DocumentFile, err, ok, parseDocument, type Result, SCHEMA_VERSION } from '@fluxion/schema';
import type { FormatError } from './errors.js';
import { recoverTruncated } from './salvage-text.js';

/**
 * Why a document was opened in part, and what was left out.
 *
 * @public
 */
export type Salvage = {
  /** `truncated`: the text was cut off; `invalid`: some records failed validation; `newer-major`: written by a newer major version. */
  readonly reason: 'truncated' | 'invalid' | 'newer-major';
  /** The ids of the records that were dropped because they were invalid or depended on one that was. */
  readonly dropped: readonly string[];
  /** For `truncated`: how many complete records were read before the cut; records after it are lost and cannot be listed. */
  readonly recovered?: number;
  /**
   * For `truncated`: true when neither the text nor the manifest said which schema version the records are (the canonical writer puts
   * `schemaVersion` after the records, so a cut loses it). They were read as the current version, so the document opens read-only.
   */
  readonly versionGuessed?: true;
};

/** A document opened, perhaps in part. */
export type OpenedDocument = {
  readonly document: DocumentFile;
  readonly diagnostics: readonly Diagnostic[];
  readonly readOnly: boolean;
  readonly salvage?: Salvage;
};

const fail = (message: string): Result<never, FormatError> => err({ code: 'FILE_DOCUMENT_INVALID', message });

/** The ids of the records in `raw` that are not in `kept`. */
function droppedIds(raw: unknown, kept: DocumentFile): string[] {
  const records = typeof raw === 'object' && raw !== null ? (raw as { readonly records?: unknown }).records : undefined;
  if (typeof records !== 'object' || records === null) return [];
  return Object.keys(records).filter((id) => !Object.hasOwn(kept.records, id));
}

/** `text` parsed, salvaging a document that fails validation: the valid records and the ids left out. */
function parseOrSalvage(text: string, reason: Salvage['reason'], readOnly: boolean, extra: Partial<Salvage> = {}): Result<OpenedDocument, FormatError> {
  const parsed = parseDocument(text);
  if (parsed.ok) {
    const salvage: Salvage | undefined = reason === 'invalid' ? undefined : { reason, dropped: [], ...extra };
    return ok({ document: parsed.value.document, diagnostics: parsed.value.diagnostics, readOnly, ...(salvage ? { salvage } : {}) });
  }
  const kept = parsed.error.salvaged;
  if (kept === null || Object.keys(kept.records).length === 0) return fail(parsed.error.message);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = undefined;
  }
  return ok({ document: kept, diagnostics: parsed.error.diagnostics, readOnly, salvage: { reason, dropped: droppedIds(raw, kept), ...extra } });
}

/** The major version of `schemaVersion`, when it is a "MAJOR.MINOR" string. */
const majorOf = (schemaVersion: unknown): number | undefined =>
  typeof schemaVersion === 'string' ? Number(/^(\d+)\.\d+$/.exec(schemaVersion)?.[1]) : undefined;

/** `text` with its `schemaVersion` replaced by the current one, when it names a newer major; undefined when it does not. */
function asCurrentVersion(text: string): string | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const major = majorOf((value as { readonly schemaVersion?: unknown }).schemaVersion);
  const current = majorOf(SCHEMA_VERSION) as number;
  return major !== undefined && major > current ? JSON.stringify({ ...value, schemaVersion: SCHEMA_VERSION }) : undefined;
}

/**
 * Open the text of a `document.json`: in full, salvaged, or read-only. A failure only when nothing of it can be read. `versionHint` is the
 * schema version the manifest names, used when a cut-off text lost its own.
 */
export function openDocumentText(text: string, versionHint?: string): Result<OpenedDocument, FormatError> {
  const newer = asCurrentVersion(text);
  if (newer !== undefined) return parseOrSalvage(newer, 'newer-major', true);
  const parsed = parseDocument(text);
  if (parsed.ok || parsed.error.code !== 'DOCUMENT_JSON_INVALID') return parseOrSalvage(text, 'invalid', false);
  const recovered = recoverTruncated(text);
  if (recovered === undefined) return fail(parsed.error.message);
  const version = recovered.schemaVersion ?? versionHint;
  const rebuilt = JSON.stringify({ schemaVersion: version ?? SCHEMA_VERSION, records: recovered.records });
  // a cut file can name a newer major as well: it opens read-only, as an uncut one would
  const asNewer = asCurrentVersion(rebuilt);
  const guessed = version === undefined;
  const extra: Partial<Salvage> = { recovered: Object.keys(recovered.records).length, ...(guessed ? { versionGuessed: true as const } : {}) };
  return parseOrSalvage(asNewer ?? rebuilt, 'truncated', asNewer !== undefined || guessed, extra);
}
