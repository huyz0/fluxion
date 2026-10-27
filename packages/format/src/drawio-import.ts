import { parseShapeDef } from '@fluxion/core';
import { type Diagnostic, qualifiedNameSchema } from '@fluxion/schema';
import { decodeBase64 } from './base64.js';
import type { DrawioEntryOutcome, DrawioImportOptions, DrawioImportReport } from './drawio-import-types.js';
import { modelSvg } from './drawio-model.js';
import { type Budget, Unsupported } from './drawio-paint.js';
import { stencilSvg } from './drawio-stencil.js';
import { elements, readXml, textOf, type XmlLimits, type XmlNode } from './drawio-xml.js';
import { inflateRaw } from './inflate.js';
import { sha256Hex } from './sha256.js';
import { importSvgShape } from './svg-import.js';
import type { SvgImportResult } from './svg-import-types.js';
import { decodeUtf8Strict, encodeUtf8 } from './utf8.js';

export type { DrawioEntryOutcome, DrawioImportOptions, DrawioImportReport, DrawioProcessedReport } from './drawio-import-types.js';

/** Bounds before parsing, decoding and conversion (ADR-0049). */
const LIBRARY_CHARS = 32 * 1024 * 1024;
const MAX_ENTRIES = 4096;
const ENTRY_CHARS = 2 * 1024 * 1024;
const INFLATED_BYTES = 2 * 1024 * 1024;
/** Library-wide work: decoded model and SVG text plus converted SVG, so many bounded entries stay bounded (review r3). */
const WORK_CHARS = 16 * 1024 * 1024;
/** Library-wide conversion steps (cells, route points walked, placeholder lookups). */
const WORK_STEPS = 16 * 1024 * 1024;
/** Base64 text of an embedded SVG at the 2 Mi character limit, refused before decoding. */
const SVG_DATA_CHARS = Math.ceil((ENTRY_CHARS * 4) / 3) + 64;
/** mxlibrary rows are objects in one array: deeper JSON is refused before parsing. */
const JSON_DEPTH = 3;
const LIBRARY_XML: XmlLimits = { maxChars: LIBRARY_CHARS, maxNodes: 200_000, maxDepth: 64 };
const ENTRY_XML: XmlLimits = { maxChars: ENTRY_CHARS, maxNodes: 20_000, maxDepth: 64 };
const NAMESPACE = /^[a-z0-9][a-z0-9-]*$/;

type Kind = DrawioEntryOutcome['kind'];
type Converted = { readonly svg: string; readonly anchors?: SvgImportResult['definition']['anchors']; readonly omissions: readonly string[] };
type Source = { readonly title?: string; readonly kind: Kind; readonly convert: (budget: Budget) => Converted };

const problem = (code: 'FLX_SVG_IMPORT_INVALID' | 'FLX_SVG_IMPORT_UNSUPPORTED', message: string, path = ''): Diagnostic => ({
  code,
  severity: 'error',
  path,
  message,
});
const failed = (message: string): DrawioImportReport => ({ status: 'failed', diagnostics: [problem('FLX_SVG_IMPORT_INVALID', message)] });
const unsupported = (message: string): never => {
  throw new Unsupported(message);
};
const WORK_LIMIT = `library-work-limit: decoded and converted entries exceed ${WORK_CHARS / 1024 / 1024} Mi characters or the step budget`;
/** Charge decoded or converted characters to the library budget; the entry that overruns it is refused. */
const spend = (budget: Budget, chars: number): void => {
  budget.left -= chars;
  if (budget.left < 0) unsupported(WORK_LIMIT);
};

/** An entry's model text: escaped XML as is, or base64 then raw DEFLATE then URI decoding, each bounded. */
function modelText(xml: string, budget: Budget): { text: string; kind: Kind } {
  spend(budget, xml.length);
  if (xml.startsWith('<')) return { text: xml, kind: 'model' };
  const bytes = decodeBase64(xml) ?? unsupported('compressed model is not base64');
  const inflated = inflateRaw(bytes, INFLATED_BYTES);
  if (!inflated.ok) unsupported('compressed model exceeds 2 MiB or is not raw DEFLATE');
  const encoded = decodeUtf8Strict(inflated.ok ? inflated.value : new Uint8Array()) ?? unsupported('compressed model is not UTF8');
  let text: string;
  try {
    text = decodeURIComponent(encoded);
  } catch {
    return unsupported('compressed model is not URI encoded');
  }
  if (text.length > ENTRY_CHARS) unsupported('model exceeds 2 Mi characters');
  spend(budget, text.length);
  return { text, kind: 'compressed-model' };
}

function modelSource(xml: string, title: string | undefined): Source {
  // the kind is known only after decoding; plain entries are the escaped-XML form
  const kind: Kind = xml.startsWith('<') ? 'model' : 'compressed-model';
  return {
    ...(title === undefined ? {} : { title }),
    kind,
    convert: (budget) => {
      const model = readXml(modelText(xml, budget).text, ENTRY_XML) ?? unsupported('model is not strictly well-formed bounded XML');
      return modelSvg(model, budget);
    },
  };
}

function svgSource(data: string, title: string | undefined): Source {
  return {
    ...(title === undefined ? {} : { title }),
    kind: 'svg',
    convert: (budget) => {
      if (data.length > SVG_DATA_CHARS) unsupported('embedded SVG exceeds 2 Mi characters');
      spend(budget, data.length);
      const match = /^data:image\/svg\+xml;base64,([A-Za-z0-9+/=\s]*)$/.exec(data) ?? unsupported('unsupported image entry: only embedded SVG is converted');
      const bytes = decodeBase64(match[1] as string) ?? unsupported('embedded SVG is not base64');
      const svg = decodeUtf8Strict(bytes) ?? unsupported('embedded SVG is not UTF8');
      return { svg, omissions: [] };
    },
  };
}

function rowSource(row: unknown): Source {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return { kind: 'unknown', convert: () => unsupported('library entry is not an object') };
  const { title, xml, data } = row as { title?: unknown; xml?: unknown; data?: unknown };
  const named = typeof title === 'string' ? title : undefined;
  if (typeof xml === 'string') return modelSource(xml, named);
  if (typeof data === 'string') return svgSource(data, named);
  return { ...(named === undefined ? {} : { title: named }), kind: 'unknown', convert: () => unsupported('library entry has neither xml nor data') };
}

type Scan = { depth: number; rows: number };
const open = (s: Scan): void => {
  s.depth++;
};
const close = (s: Scan): void => {
  s.depth--;
};
/** Structural characters outside strings, by char code: brackets nest, top-level commas separate rows. */
const JSON_STRUCTURE: { readonly [code: number]: (s: Scan) => void } = {
  91: open,
  123: open,
  93: close,
  125: close,
  44: (s) => {
    if (s.depth === 1) s.rows++;
  },
};

/** A linear pre-scan outside strings: refuses deep nesting and over-long top-level arrays before `JSON.parse`. */
function jsonTooLarge(text: string): string | undefined {
  const scan = { depth: 0, rows: 0 };
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x22) i = stringEnd(text, i);
    else JSON_STRUCTURE[c]?.(scan);
    if (scan.depth > JSON_DEPTH) return `mxlibrary JSON nests deeper than ${JSON_DEPTH}`;
    if (scan.rows >= MAX_ENTRIES) return `library exceeds ${MAX_ENTRIES} entries`;
  }
  return undefined;
}

/** The index of the quote closing the JSON string opened at `open`, or the end of the text. */
function stringEnd(text: string, open: number): number {
  for (let i = open + 1; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x5c) i++;
    else if (c === 0x22) return i;
  }
  return text.length;
}

function mxlibrarySources(root: XmlNode): Source[] | string {
  const json = textOf(root);
  const tooLarge = jsonTooLarge(json);
  if (tooLarge) return tooLarge;
  let rows: unknown;
  try {
    rows = JSON.parse(json);
  } catch {
    return 'mxlibrary content is not JSON';
  }
  if (!Array.isArray(rows)) return 'mxlibrary content is not an entry array';
  if (rows.length > MAX_ENTRIES) return `library exceeds ${MAX_ENTRIES} entries`;
  return rows.map(rowSource);
}

function stencilSources(root: XmlNode): Source[] | string {
  const shapes = elements(root);
  if (shapes.length > MAX_ENTRIES) return `library exceeds ${MAX_ENTRIES} entries`;
  return shapes.map((shape) => {
    const name = shape.attributes.get('name');
    if (shape.name !== 'shape') return { kind: 'unknown' as const, convert: () => unsupported(`unsupported library node: ${shape.name}`) };
    return { ...(name === undefined ? {} : { title: name }), kind: 'stencil' as const, convert: (budget) => ({ ...stencilSvg(shape, budget), omissions: [] }) };
  });
}

/** Unique qualified IDs from titles: lower-case words joined by hyphens, numbered on collision or when empty. */
function idsOf(namespace: string, sources: readonly Source[]): string[] {
  const used = new Set<string>();
  // the next suffix to try per base slug, so many equal titles number in linear time
  const next = new Map<string, number>();
  return sources.map((s, i) => {
    const slug = (s.title ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64);
    let id = `${namespace}:${slug || `entry-${i + 1}`}`;
    const base = slug || 'entry';
    let n = next.get(base) ?? 2;
    for (; used.has(id) || !qualifiedNameSchema.safeParse(id).success; n++) id = `${namespace}:${base}-${n}`;
    next.set(base, n);
    used.add(id);
    return id;
  });
}

/** Only this entry is lost: an engine error (stack, memory) or converter fault is a refusal, never a library failure. */
const failureOf = (e: unknown, path: string): Diagnostic =>
  e instanceof Unsupported
    ? problem('FLX_SVG_IMPORT_UNSUPPORTED', e.message, path)
    : problem('FLX_SVG_IMPORT_INVALID', `entry conversion failed: ${e instanceof Error ? e.name : 'error'}`, path);

type Context = { readonly options: Omit<DrawioImportOptions, 'namespace'>; readonly budget: Budget };

async function convert(source: Source, at: { index: number; id: string }, context: Context): Promise<DrawioEntryOutcome> {
  const base = { index: at.index, id: at.id, kind: source.kind, ...(source.title === undefined ? {} : { title: source.title }) };
  const path = `/entries/${at.index}`;
  let converted: Converted;
  try {
    if (context.budget.left <= 0 || context.budget.steps <= 0) unsupported(WORK_LIMIT);
    converted = source.convert(context.budget);
    spend(context.budget, converted.svg.length);
  } catch (e) {
    return { ...base, status: 'refused', diagnostics: [failureOf(e, path)] };
  }
  const result = await importSvgShape(converted.svg, { ...context.options, id: at.id });
  if (!result.ok) return { ...base, status: 'refused', diagnostics: result.error };
  // stencil connection points replace the derived anchors; fewer than four keep the derived ones too
  const own = converted.anchors ?? [];
  const derived = result.value.definition.anchors ?? [];
  const definition = own.length
    ? parseShapeDef({ ...result.value.definition, anchors: dedupe([...own, ...(own.length < 4 ? derived : [])]) })
    : { ok: true as const, value: result.value.definition };
  if (!definition.ok) return { ...base, status: 'refused', diagnostics: definition.error };
  return { ...base, status: 'accepted', value: { ...result.value, definition: definition.value }, omissions: converted.omissions };
}

/** Anchors with unique names, first wins. */
const dedupe = <T extends { readonly name: string }>(anchors: readonly T[]): T[] => {
  const seen = new Set<string>();
  return anchors.filter((a) => !seen.has(a.name) && seen.add(a.name) !== undefined);
};

function sourcesOf(text: string): { format: 'stencil' | 'mxlibrary'; sources: Source[] } | string {
  if (typeof text !== 'string' || text.length > LIBRARY_CHARS) return 'library exceeds 32 Mi characters or is not text';
  const root = readXml(text, LIBRARY_XML);
  if (!root) return 'library is not strictly well-formed bounded XML (no doctype or entities)';
  const format = root.name === 'mxlibrary' ? 'mxlibrary' : root.name === 'shapes' ? 'stencil' : undefined;
  if (!format) return 'expected an mxlibrary or shapes library';
  const sources = format === 'mxlibrary' ? mxlibrarySources(root) : stencilSources(root);
  if (typeof sources === 'string') return sources;
  return sources.length ? { format, sources } : 'library has no entries';
}

/**
 * Convert a draw.io library (`<mxlibrary>` JSON entries or a `<shapes>` stencil file), best effort: stencils, model
 * fragments (plain or compressed) and embedded SVG images become witnessed definitions; unsupported entries are
 * refused individually and stay in the denominator. No XML entity, script, style expression or URL is evaluated.
 * @public
 */
export async function importDrawioLibrary(text: string, options: DrawioImportOptions): Promise<DrawioImportReport> {
  const { namespace, ...rest } = options;
  if (typeof namespace !== 'string' || !NAMESPACE.test(namespace)) return failed('invalid target namespace');
  const parsed = sourcesOf(text);
  if (typeof parsed === 'string') return failed(parsed);
  const ids = idsOf(namespace, parsed.sources);
  const entries: DrawioEntryOutcome[] = [];
  const context: Context = { options: rest, budget: { left: WORK_CHARS, steps: WORK_STEPS } };
  for (const [index, source] of parsed.sources.entries()) entries.push(await convert(source, { index, id: ids[index] as string }, context));
  return {
    status: 'processed',
    format: parsed.format,
    sourceSha256: sha256Hex(encodeUtf8(text)),
    entryCount: entries.length,
    acceptedCount: entries.filter((e) => e.status === 'accepted').length,
    entries,
  };
}
