// The `migrate` operation: bring a document to the current schema version (FR-DOC-003, FR-CLI-002).
import { type DocumentFile, migrate, parseDocument, serializeDocument } from '@fluxion/schema';
import { type OpResult, opFail, opOk } from './result.js';

/**
 * Migrate the document in `text`. A document already current comes back unchanged (`applied` is empty).
 *
 * @public
 */
export function migrateDocument(text: string): OpResult<{ readonly document: DocumentFile; readonly text: string; readonly applied: readonly string[] }> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    const parsed = parseDocument(text);
    return opFail(parsed.ok ? [] : parsed.error.diagnostics);
  }
  const moved = migrate(raw);
  if (!moved.ok) return opFail([{ code: 'FLX_VERSION_UNSUPPORTED', severity: 'error', path: moved.error.path ?? '', message: moved.error.message }]);
  const parsed = parseDocument(JSON.stringify(moved.value.document));
  if (!parsed.ok) return opFail(parsed.error.diagnostics);
  return opOk({ document: parsed.value.document, text: serializeDocument(parsed.value.document), applied: moved.value.applied }, parsed.value.diagnostics);
}
