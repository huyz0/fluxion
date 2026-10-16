// The `compile` operation: FluxScript text to a document (FR-CLI-002). Any error diagnostic fails it; warnings ride beside the result.
import { compile } from '@fluxion/dsl';
import { type Diagnostic, type DocumentFile, serializeDocument } from '@fluxion/schema';
import type { CoreRegistries } from '@fluxion/sdk';
import { type OpResult, opFail, opOk } from './result.js';

/**
 * Compile the FluxScript `text`. Fails with every diagnostic when one is an error or no document came out.
 *
 * @public
 */
export function compileDocument(
  text: string,
  registries: CoreRegistries,
): OpResult<{ readonly document: DocumentFile; readonly text: string; readonly screens: number; readonly records: number }> {
  const r = compile(text, { registries });
  // FluxScript codes (`FLX_DSL_*`) are not schema codes; the reply schema accepts both, so the type is widened here only
  const diagnostics = r.diagnostics.map(({ source: _source, ...d }) => d) as readonly Diagnostic[];
  if (!r.doc || diagnostics.some((d) => d.severity === 'error')) return opFail(diagnostics);
  return opOk({ document: r.doc, text: serializeDocument(r.doc), screens: r.stats.screens, records: r.stats.records }, diagnostics);
}
