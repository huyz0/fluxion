// The `patch`, `decompile` and `catalog` operations (FR-AI-003, FR-DSL-004, FR-AI-002, FR-CLI-002).
import { type AppliedPatch, buildCatalog, type CatalogFormat, decompile, formatCatalog, type MermaidExport, patchDocument, toMermaid } from '@fluxion/dsl';
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
 * What {@link catalogText} lists.
 *
 * @public
 */
export type CatalogTextOptions = {
  /** Only the entries this pack registered, in full: what a catalog's `packs` summary line names (ADR-0211, ADR-0212). */
  readonly pack?: string;
};

/** The ids of every registrant of `registries` (`core`, `basic`, a pack's id), sorted. */
function registrants(registries: CoreRegistries): string[] {
  return (buildCatalog(registries, { core: [] }).catalog.packs ?? []).map((p) => p.id);
}

/**
 * The catalog of what `registries` can draw, as `format`; with `pack`, only that pack's entries, and an error naming the registered packs when it
 * registered none.
 *
 * @public
 */
export function catalogText(registries: CoreRegistries, format: CatalogFormat, options: CatalogTextOptions = {}): OpResult<{ readonly text: string }> {
  const { pack } = options;
  const known = pack === undefined ? [] : registrants(registries);
  if (pack !== undefined && !known.includes(pack)) {
    // the registered packs are in the message, which every surface prints (an MCP tool error's text carries code and message only)
    return opFail([
      {
        code: 'FLX_CLI_USAGE',
        severity: 'error',
        path: '',
        message: `no pack "${pack}" is registered; registered: ${known.join(', ')}`,
        hint: 'Ask for one of the registered packs, or list the whole catalog without pack.',
      },
    ]);
  }
  const built = buildCatalog(registries, pack === undefined ? {} : { detail: 'full', pack });
  return opOk({ text: formatCatalog(built.catalog, format) }, built.diagnostics);
}

/**
 * The first screen (or `screenId`) of the document in `text` as a Mermaid flowchart; lossy (FR-EXP-007).
 *
 * @public
 */
export function mermaidText(text: string, screenId?: string): OpResult<MermaidExport> {
  const parsed = parseDocument(text);
  if (!parsed.ok) return opFail(parsed.error.diagnostics);
  return opOk(toMermaid(parsed.value.document, screenId), parsed.value.diagnostics);
}
