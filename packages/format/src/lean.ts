// The player's reader (ADR-0026, NFR-SIZE-001, NFR-SEC-001, NFR-REL-002): the same container as the loader, and a `document.json` read by structure instead of
// by the schema. It carries no validator, so a one-file player does not ship one. It does not migrate, repair or salvage: a file written for another schema
// version, a text that is not JSON and a document with no readable record are refused with a message that says to open the file in the studio, which does
// all three (FR-FIL-009). A record that is not well formed (not an object, an id that is not its key, an unknown type, an ordering key or a parent that is not
// a string) is left out and listed. Fields beyond those are not checked: the views read them defensively and the player draws a screen that throws as nothing. What reaches the screen is drawn from typed fields by the render views, which build their DOM
// from them and never from strings of the file; links go through `safeLinkUrl` and images through `sanitizeAsset`.
import { type AnyRecord, type DocumentFile, err, ok, RECORD_TYPES, type Result, SCHEMA_VERSION } from '@fluxion/schema';
import type { OpenedDocument } from './document-open.js';
import type { FormatError } from './errors.js';
import { type LoadedFlux, type LoadOptions, loadFluxWith } from './loader-core.js';

const KNOWN = new Set(RECORD_TYPES);
/** The studio opens, repairs and saves what this player cannot read. */
const STUDIO = 'open it in the studio and save it again';

const fail = (message: string): Result<never, FormatError> => err({ code: 'FILE_DOCUMENT_INVALID', message });
const isObject = (v: unknown): v is { readonly [key: string]: unknown } => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Whether `record` is well formed for the views: an object whose id is its key, of a known type, with the string fields the views order and nest by. */
function wellFormed(key: string, record: unknown): record is AnyRecord {
  if (!isObject(record) || record['id'] !== key || typeof record['type'] !== 'string' || !KNOWN.has(record['type'])) return false;
  if ((record['type'] === 'screen' || record['type'] === 'element' || record['type'] === 'section') && typeof record['index'] !== 'string') return false;
  return record['type'] !== 'element' || (typeof record['screenId'] === 'string' && typeof record['kind'] === 'string');
}

// The schema versions this reader opens without migrating: the current one, and 1.2, whose step to 1.3 only adds optional fields the player
// does not read (ADR-0031: layouts and the FluxScript source). It reads them as the current version, as the validating loader would after migrating.
const LEAN_READS: ReadonlySet<string> = new Set([SCHEMA_VERSION, '1.2']);

/**
 * Read the text of a `document.json` by structure: the records that are well formed, the ids of those that are not. Refuses a text that is not JSON, one that names
 * a schema version other than the current one or 1.2, and one with no readable record. Never throws.
 *
 * @public
 */
export function leanDocumentText(text: string): Result<OpenedDocument, FormatError> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return fail(`document.json cannot be read (it is not valid JSON or is cut off): ${STUDIO}`);
  }
  if (!isObject(value) || !isObject(value['records'])) return fail(`document.json is not a document: ${STUDIO}`);
  if (typeof value['schemaVersion'] !== 'string' || !LEAN_READS.has(value['schemaVersion']))
    return fail(`this document was written for schema ${String(value['schemaVersion'])} and this player reads ${SCHEMA_VERSION}: ${STUDIO}`);
  const kept: { [id: string]: AnyRecord } = {};
  const dropped: string[] = [];
  for (const [key, record] of Object.entries(value['records'])) {
    // defined, not assigned: a record keyed `__proto__` is an own key here as it is in the validating loader, never the prototype of `kept`
    if (wellFormed(key, record)) Object.defineProperty(kept, key, { value: record, enumerable: true, writable: true, configurable: true });
    else dropped.push(key);
  }
  if (Object.keys(kept).length === 0) return fail(`document.json holds no readable record: ${STUDIO}`);
  const document = { ...value, schemaVersion: SCHEMA_VERSION, records: kept } as unknown as DocumentFile;
  // a document with dropped records is shown as far as it reads and is never saved over: this reader writes nothing, and the studio repairs it
  return ok({ document, diagnostics: [], readOnly: dropped.length > 0, ...(dropped.length > 0 ? { salvage: { reason: 'invalid' as const, dropped } } : {}) });
}

/**
 * Open the `.flux` file `bytes` for presenting: the loader's container and checks, and `leanDocumentText` for the document. Never throws.
 *
 * @public
 */
export function loadFluxLean(bytes: Uint8Array, options: LoadOptions): Promise<Result<LoadedFlux, FormatError>> {
  return loadFluxWith(bytes, options, leanDocumentText);
}
