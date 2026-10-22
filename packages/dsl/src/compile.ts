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
import { type NamedHeader, upsertScreens } from './stream/upsert.js';
import { lowerTemplates } from './template/lower.js';
import type { CompileOptions, CompileResult, DslDiagnostic, SourceRange } from './types.js';
import { validateFlux } from './validate/validate.js';

/** The base document's document record, whose `source.salt` a recompile keeps (ADR-0031). */
function documentOf(base: DocumentFile | undefined): { readonly source?: { readonly salt?: unknown } } | undefined {
  return Object.values(base?.records ?? {}).find((r) => r.type === 'document') as { readonly source?: { readonly salt?: unknown } } | undefined;
}

const stopped = (diagnostics: readonly DslDiagnostic[]): CompileResult => ({ diagnostics, sourceMap: new Map(), stats: { screens: 0, records: 0 } });

/** A compile, and the ids (source slugs) of the screens the text gave. */
export type Compiled = {
  /** The result, with the text's screens already upserted into `options.base`. */
  readonly result: CompileResult;
  /** The screens the text compiled, by source id, in source order. */
  readonly screens: readonly string[];
};

const countsOf = (doc: DocumentFile): CompileResult['stats'] => {
  const records = Object.values(doc.records);
  return { screens: records.filter((r) => r.type === 'screen').length, records: records.length };
};

/** Compile `text` on its own, then (with a `base`) upsert its screens into the base (see stream/upsert.ts for what a screen owns). */
export function compileText(text: string, options: CompileOptions): Compiled {
  const { fresh, screens, named } = compileFresh(text, options);
  if (!(options.base && fresh.doc)) return { result: fresh, screens };
  const doc = upsertScreens(options.base, fresh.doc, named);
  // a text without a title (a screen block alone) is complete when the base has one
  const titled = Object.values(options.base.records).some((r) => r.type === 'document' && (r as { title?: unknown }).title !== undefined);
  const diagnostics = titled && !named.title ? fresh.diagnostics.filter((d) => !(d.code === 'FLX_SCHEMA_INVALID' && d.path === '/title')) : fresh.diagnostics;
  return { result: { ...fresh, doc, diagnostics, stats: countsOf(doc) }, screens };
}

/**
 * Compile FluxScript text to a document. The same text, options and registries give the same document, byte for byte once serialized.
 * Every record of the document maps to a source range: its own construct, else (a theme the file does not name, a file without a title)
 * the whole file.
 *
 * With `options.base` the text's screens are upserted into that document instead (FR-AI-010, ADR-0031): the records a screen owns (the
 * screen, its elements and the bindings of its connectors) are replaced by the text's, so a record that did not change keeps its id and a
 * node deleted from the text leaves with its connectors; every other record of the base is kept, and a screen of the text the base lacks is
 * appended. The title and theme are replaced only when the text names them. The source map and diagnostics are those of the text.
 *
 * @param text - a `*.flux.yaml` file, or a header with only the screens to upsert
 * @param options - registries, id hash and salt, the mode, and the base document
 * @returns the document (absent when the text does not parse or is not a `flux: 1` mapping), every diagnostic, the source map and counts
 * @public
 */
export function compile(text: string, options: CompileOptions): CompileResult {
  return compileText(text, options).result;
}

type Fresh = { readonly fresh: CompileResult; readonly screens: readonly string[]; readonly named: NamedHeader };
const NOTHING: NamedHeader = { title: false, theme: false };

function compileFresh(text: string, options: CompileOptions): Fresh {
  const parsed = parseFlux(text);
  if (!parsed.root) return { fresh: stopped(parsed.diagnostics), screens: [], named: NOTHING };
  const read = readFlux(parsed.root, text);
  if (!read.ast) return { fresh: stopped([...parsed.diagnostics, ...read.diagnostics]), screens: [], named: NOTHING };
  const { registries } = options;
  const lowered = lowerTemplates(read.ast, registries);
  const resolved = resolveFlux(lowered.ast, registries);
  const salt = resolveSalt(documentOf(options.base), options.salt);
  const expanded = expandFlux(lowered.ast, resolved.resolution, { salt, registries, ...(options.hasher ? { hasher: options.hasher } : {}) });
  const placed = placeFlux(expanded, { registries });
  const whole: SourceRange = parsed.root.range;
  const sourceMap = new Map<RecordId, SourceRange>();
  for (const id of Object.keys(placed.records).sort()) sourceMap.set(id as RecordId, expanded.sourceMap.get(id as RecordId) ?? whole);
  const validated = validateFlux({ records: placed.records, sourceMap }, { mode: options.mode ?? 'strict', fallback: whole });
  return {
    fresh: {
      doc: validated.doc,
      diagnostics: [
        ...parsed.diagnostics,
        ...read.diagnostics,
        ...lowered.diagnostics,
        ...resolved.diagnostics,
        ...expanded.diagnostics,
        ...placed.diagnostics,
        ...validated.diagnostics,
      ],
      sourceMap,
      stats: countsOf(validated.doc),
    },
    screens: read.ast.screens.map((s) => s.id.value),
    named: { title: read.ast.title !== undefined, theme: read.ast.theme !== undefined },
  };
}
