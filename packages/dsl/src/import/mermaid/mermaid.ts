// The Mermaid importer (FR-IMP-001, FR-DSL-007, ADR-0040): the first line picks the kind; each kind has a small hand-written parser that
// yields one screen; the screen is written as FluxScript, which the compiler then validates and lays out like any authored file.

import type { DslDiagnostic } from '../../types.js';
import { emitFlux, type ScreenSpec } from '../emit.js';
import { type ParseCtx, Report, Slugs, type SourceLine, sourceLines } from '../source.js';
import type { ImportOptions, ImportResult } from '../types.js';
import { parseClass, parseEr } from './class-er.js';
import { parseFlowchart } from './flowchart.js';
import { parseMindmap } from './mindmap.js';
import { parseSequence } from './sequence.js';
import { parseTimeline } from './timeline.js';

type Parser = (header: SourceLine, body: readonly SourceLine[], ctx: ParseCtx) => ScreenSpec | undefined;

const KINDS: Readonly<Record<string, Parser>> = {
  flowchart: parseFlowchart,
  graph: parseFlowchart,
  sequenceDiagram: parseSequence,
  mindmap: parseMindmap,
  timeline: parseTimeline,
  classDiagram: parseClass,
  erDiagram: parseEr,
};

/** The lines after an optional `---` front matter, which is reported and skipped. */
function withoutFrontMatter(lines: readonly SourceLine[], report: Report): SourceLine[] {
  const first = lines.findIndex((l) => l.text.trim() !== '');
  if (first < 0 || lines[first]?.text.trim() !== '---') return [...lines];
  const end = lines.findIndex((l, i) => i > first && l.text.trim() === '---');
  if (end < 0) return [...lines];
  report.unsupported(lines[first] as SourceLine, 'front matter');
  return lines.slice(end + 1);
}

/** One diagram as a screen, for callers (the Markdown importer) that assemble several. */
export function parseMermaid(text: string, ctx: ParseCtx): ScreenSpec | undefined {
  const { report } = ctx;
  const lines = withoutFrontMatter(sourceLines(text), report);
  const at = lines.findIndex((l) => l.text.trim() !== '' && !l.text.trim().startsWith('%%'));
  const header = lines[at];
  if (!header) {
    report.syntax(lines[0] ?? { text: '', line: 1, offset: 0 }, 'the Mermaid source is empty');
    return undefined;
  }
  const kind = header.text.trim().split(/\s+/)[0] ?? '';
  const parser = Object.hasOwn(KINDS, kind) ? KINDS[kind] : undefined;
  if (!parser) {
    report.unknownKind(header, kind);
    return undefined;
  }
  return parser(header, lines.slice(at + 1), ctx);
}

/**
 * Imports Mermaid source (flowchart, sequence, mindmap, timeline, class or ER, the subset ADR-0040 lists) as a FluxScript file with one screen.
 * What lies outside the subset is skipped with `FLX_IMPORT_UNSUPPORTED`; an unreadable statement is `FLX_IMPORT_SYNTAX`; another kind is
 * `FLX_IMPORT_UNKNOWN_KIND`. The text is returned for the compiler to validate and lay out; it is not compiled here.
 *
 * @param text - the Mermaid source
 * @param options - the deck title and the screen id
 * @returns the FluxScript file, or the diagnostics that stopped it
 * @public
 */
export function importMermaid(text: string, options: ImportOptions = {}): ImportResult {
  const report = new Report();
  const title = options.title ?? 'Imported diagram';
  const screen = parseMermaid(text, { report, slugs: new Slugs(), id: options.screenId ?? 'diagram', title });
  const diagnostics: readonly DslDiagnostic[] = report.items;
  if (!screen || report.failed) return { ok: false, diagnostics };
  return { ok: true, flux: emitFlux(options.title ?? screen.title, [screen]), diagnostics };
}
