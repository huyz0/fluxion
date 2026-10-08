// The public compile (06-ai-authoring.md §3, ADR-0030 "Pipeline stages in R2", ADR-0031): parse → read → resolve → expand (and style)
// → place → validate. A stage that leaves nothing to go on stops the compile with no document: text that does not parse, or a file the
// read stage cannot take as FluxScript (not a mapping, no `flux: 1`). Every later stage runs whatever the earlier ones reported, so one
// compile shows every problem. Diagnostics come in stage order, each stage's in its own deterministic order (validate's in source order);
// the formatter ranks them when shown. No clock: `stats` holds counts only (06's `msPerStage` needs a clock port, and R2 has none).
import { resolveSalt } from '@fluxion/core';
import type { DocumentFile, RecordId } from '@fluxion/schema';
import { expandFlux } from './expand/expand.js';
import { parseFlux } from './parse/parse.js';
import { placeFlux } from './place/place.js';
import { readFlux } from './read/read.js';
import { resolveFlux } from './resolve/resolve.js';
import type { CompileOptions, CompileResult, DslDiagnostic, SourceRange } from './types.js';
import { validateFlux } from './validate/validate.js';

/** The base document's document record, whose `source.salt` a recompile keeps (ADR-0031). */
function documentOf(base: DocumentFile | undefined): { readonly source?: { readonly salt?: unknown } } | undefined {
  return Object.values(base?.records ?? {}).find((r) => r.type === 'document') as { readonly source?: { readonly salt?: unknown } } | undefined;
}

const stopped = (diagnostics: readonly DslDiagnostic[]): CompileResult => ({ diagnostics, sourceMap: new Map(), stats: { screens: 0, records: 0 } });

/**
 * Compile FluxScript text to a document. The same text, options and registries give the same document, byte for byte once serialized.
 * Every record of the document maps to a source range: its own construct, else (a theme the file does not name, a file without a title)
 * the whole file.
 *
 * @param text - a `*.flux.yaml` file
 * @param options - registries, id hash and salt, and the mode
 * @returns the document (absent when the text does not parse or is not a `flux: 1` mapping), every diagnostic, the source map and counts
 * @public
 */
export function compile(text: string, options: CompileOptions): CompileResult {
  const parsed = parseFlux(text);
  if (!parsed.root) return stopped(parsed.diagnostics);
  const read = readFlux(parsed.root, text);
  if (!read.ast) return stopped([...parsed.diagnostics, ...read.diagnostics]);
  const { registries } = options;
  const resolved = resolveFlux(read.ast, registries);
  const salt = resolveSalt(documentOf(options.base), options.salt);
  const expanded = expandFlux(read.ast, resolved.resolution, { salt, registries, ...(options.hasher ? { hasher: options.hasher } : {}) });
  const placed = placeFlux(expanded, { registries });
  const whole: SourceRange = parsed.root.range;
  const sourceMap = new Map<RecordId, SourceRange>();
  for (const id of Object.keys(placed.records).sort()) sourceMap.set(id as RecordId, expanded.sourceMap.get(id as RecordId) ?? whole);
  const validated = validateFlux({ records: placed.records, sourceMap }, { mode: options.mode ?? 'strict', fallback: whole });
  const records = Object.values(validated.doc.records);
  return {
    doc: validated.doc,
    diagnostics: [
      ...parsed.diagnostics,
      ...read.diagnostics,
      ...resolved.diagnostics,
      ...expanded.diagnostics,
      ...placed.diagnostics,
      ...validated.diagnostics,
    ],
    sourceMap,
    stats: { screens: records.filter((r) => r.type === 'screen').length, records: records.length },
  };
}
