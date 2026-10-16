// The `layout` operation: arrange every screen of a document with a registered algorithm (FR-LAY-001, FR-CLI-002).
import { layoutDocument as arrangeDocument } from '@fluxion/dsl';
import { type DocumentFile, parseDocument, serializeDocument } from '@fluxion/schema';
import type { CoreRegistries } from '@fluxion/sdk';
import { type OpResult, opFail, opOk } from './result.js';

/**
 * Lay out the screens of the document in `text` with `algorithm` (a container with a layout of its own keeps it). A screen without elements is left alone.
 *
 * @public
 */
export function layoutDocument(
  text: string,
  registries: CoreRegistries,
  algorithm = 'layered',
): OpResult<{ readonly document: DocumentFile; readonly text: string; readonly screens: number }> {
  const parsed = parseDocument(text);
  if (!parsed.ok) return opFail(parsed.error.diagnostics);
  const arranged = arrangeDocument(parsed.value.document, registries, algorithm);
  if (!arranged.ok) return opFail(arranged.diagnostics);
  return opOk({ document: arranged.document, text: serializeDocument(arranged.document), screens: arranged.screens }, parsed.value.diagnostics);
}
