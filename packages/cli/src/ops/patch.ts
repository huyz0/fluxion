// The `patch`, `decompile` and `catalog` operations (FR-AI-003, FR-DSL-004, FR-AI-002, FR-CLI-002).
import { type AppliedPatch, buildCatalog, type CatalogFormat, decompile, formatCatalog, patchDocument } from '@fluxion/dsl';
import { type Diagnostic, type DocumentFile, parseDocument, serializeDocument } from '@fluxion/schema';
import type { CoreRegistries } from '@fluxion/sdk';
import { type OpResult, opFail, opOk } from './result.js';

const jsonFailure = (what: string, e: unknown): Diagnostic => ({
  code: 'FLX_JSON_INVALID',
  severity: 'error',
  path: '',
  message: `${what} is not JSON: ${e instanceof Error ? e.message : String(e)}`,
});

/**
 * Apply the patch in `patchText` (JSON, the plain or the strict form) to the document in `text`. A patch that does not apply is rejected whole.
 *
 * @public
 */
export function patchText(
  text: string,
  patchJson: string,
  registries: CoreRegistries,
): OpResult<{ readonly document: DocumentFile; readonly text: string; readonly applied: AppliedPatch }> {
  const parsed = parseDocument(text);
  if (!parsed.ok) return opFail(parsed.error.diagnostics);
  let patch: unknown;
  try {
    patch = JSON.parse(patchJson);
  } catch (e) {
    return opFail([jsonFailure('the patch', e)]);
  }
  const r = patchDocument(parsed.value.document, patch, registries);
  if (!r.ok) return opFail(r.diagnostics);
  return opOk({ document: r.document, text: serializeDocument(r.document), applied: r.applied }, parsed.value.diagnostics);
}

/**
 * Write the document in `text` as FluxScript. Records outside the FluxScript subset are counted in `kept`, not written (ADR-0032).
 *
 * @public
 */
export function decompileText(text: string, registries: CoreRegistries): OpResult<{ readonly text: string; readonly kept: number }> {
  const parsed = parseDocument(text);
  if (!parsed.ok) return opFail(parsed.error.diagnostics);
  const r = decompile(parsed.value.document, { registries });
  return opOk({ text: r.text, kept: r.kept }, parsed.value.diagnostics);
}

/**
 * The catalog of what `registries` can draw, as `format`.
 *
 * @public
 */
export function catalogText(registries: CoreRegistries, format: CatalogFormat): OpResult<{ readonly text: string }> {
  const built = buildCatalog(registries);
  return opOk({ text: formatCatalog(built.catalog, format) }, built.diagnostics);
}
