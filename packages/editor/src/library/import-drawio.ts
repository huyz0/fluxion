// draw.io library import into the library (FR-LIB-006, ADR-0049): the shared format converter turns every stencil,
// model fragment or embedded SVG into a witnessed definition; this registers the accepted ones at once and lists them.
import type { Disposable, Registry, ShapeDef } from '@fluxion/core';
import { importDrawioLibrary as convertDrawio, type DrawioImportOptions, type DrawioProcessedReport } from '@fluxion/format';
import { type Diagnostic, err, ok, type Result } from '@fluxion/schema';
import { entryOf, type LibraryEntry } from './library-search.js';
import { registerImported } from './register-imported.js';

/**
 * A registered draw.io library.
 *
 * @public
 */
export type DrawioLibrary = Disposable & {
  /** The full conversion report: refusals and omissions included, every entry in the denominator. */
  readonly report: DrawioProcessedReport;
  /** Library entries of the accepted definitions. */
  readonly entries: readonly LibraryEntry[];
};

/**
 * Convert a draw.io library and register every accepted definition in `registry` under `source`.
 * Refuses a namespace already present, and registers nothing when any registration fails.
 *
 * @public
 */
export async function importDrawioLibrary(
  registry: Registry<string, ShapeDef>,
  text: string,
  options: DrawioImportOptions & { readonly source: string },
): Promise<Result<DrawioLibrary, readonly Diagnostic[]>> {
  const { source, ...convert } = options;
  const report = await convertDrawio(text, convert);
  if (report.status === 'failed') return err(report.diagnostics);
  const defs = report.entries.flatMap((e) => (e.status === 'accepted' ? [e.value.definition] : []));
  const registered = registerImported(registry, defs, source);
  if (!registered.ok) return registered;
  return ok({ report, entries: defs.map(entryOf), dispose: registered.value.dispose });
}
