// Iconify collection import into the library (FR-LIB-005, ADR-0049): the shared format converter turns every
// icon and alias into a witnessed definition; this registers all accepted ones at once, in a namespace nothing else
// holds, and lists the visible ones for search. Hidden icons stay registered so documents that use them still resolve.
import type { Disposable, Registry, ShapeDef } from '@fluxion/core';
import { type IconifyImportOptions, type IconifyProcessedReport, importIconifyCollection } from '@fluxion/format';
import { type Diagnostic, err, ok, type Result } from '@fluxion/schema';
import { entryOf, type LibraryEntry } from './library-search.js';

/**
 * A registered collection.
 *
 * @public
 */
export type IconifyLibrary = Disposable & {
  /** The full conversion report, refusals included. */
  readonly report: IconifyProcessedReport;
  /** Library entries of the accepted, visible icons and aliases. */
  readonly entries: readonly LibraryEntry[];
  /** Accepted IDs the collection marks hidden: registered, left out of normal search. */
  readonly hidden: ReadonlySet<string>;
};

const problem = (message: string): Diagnostic => ({ code: 'FLX_SVG_IMPORT_INVALID', severity: 'error', path: '', message });

/**
 * Convert an Iconify JSON collection and register every accepted definition in `registry` under `source`.
 * Refuses a namespace already present, and registers nothing when any registration fails.
 *
 * @public
 */
export async function importIconifyLibrary(
  registry: Registry<string, ShapeDef>,
  text: string,
  options: IconifyImportOptions & { readonly source: string },
): Promise<Result<IconifyLibrary, readonly Diagnostic[]>> {
  const { source, ...convert } = options;
  const report = await importIconifyCollection(text, convert);
  if (report.status === 'failed') return err(report.diagnostics);
  const accepted = report.entries.flatMap((e) => (e.status === 'accepted' ? [{ def: e.value.definition, hidden: e.hidden }] : []));
  if (accepted.length === 0) return err([problem('no icon in the collection could be imported')]);
  const namespace = `${accepted[0]?.def.id.split(':')[0]}:`;
  if (registry.list().some(([id]) => id.startsWith(namespace))) return err([problem(`namespace ${namespace.slice(0, -1)} is already registered`)]);
  const done: Disposable[] = [];
  for (const { def } of accepted) {
    const added = registry.register(def.id, def, source);
    if (!added.ok) {
      for (const d of done) d.dispose();
      return err([added.error]);
    }
    done.push(added.value);
  }
  return ok({
    report,
    entries: accepted.filter((a) => !a.hidden).map((a) => entryOf(a.def)),
    hidden: new Set(accepted.filter((a) => a.hidden).map((a) => a.def.id)),
    dispose: () => {
      for (const d of done) d.dispose();
    },
  });
}
