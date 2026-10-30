// The glyph inventory of a document (FR-AST-003, ADR-0051, M18.39): every Unicode scalar its screens can render with a
// document font, or why that is not known in advance. Pure: it reads the records, never changes or normalizes them.
import type { DocumentFile } from '@fluxion/schema';

/** The document's text inventory, or why its fonts must stay whole. @public */
export type GlyphInventory =
  | {
      /** Every Unicode scalar the document can render with a document font, sorted and unique. */
      readonly status: 'complete';
      /** The scalars, ascending. */
      readonly codepoints: readonly number[];
    }
  | {
      /** Some rendered text is not known in advance (a custom renderer, an unbounded generated value). */
      readonly status: 'unbounded';
      /** What makes it unbounded. */
      readonly reason: string;
    };

type Json = { readonly [key: string]: unknown };
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const field = (o: Json, key: string): unknown => o[key];
const MAX_DEPTH = 64;
const DIGITS = '0123456789';
/** Element kinds whose text is all in their records; anything else may draw text this walk cannot see. */
const KNOWN_KINDS = new Set(['shape', 'connector', 'group', 'frame', 'text', 'image']);

/**
 * List markers the browser draws in the element's font: disc, circle and square bullets by nesting depth, and
 * ordered numbers (any digits, a sign for a negative start, the period and the space after it).
 */
const LIST_MARKERS: { readonly [type: string]: string } = { bulletList: '\u2022\u25e6\u25aa ', orderedList: `${DIGITS}-. ` };

type Walk = { readonly chars: Set<number>; readonly fields: Set<string>; unbounded?: string };
/** A lone surrogate is drawn as U+FFFD, so that is what it adds. */
const addScalars = (walk: Walk, text: string): void => {
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    walk.chars.add(cp >= 0xd800 && cp <= 0xdfff ? 0xfffd : cp);
  }
};
/**
 * The text's scalars and those of its composed and decomposed forms: shapers compose a base and mark into a
 * precomposed glyph the font has (and decompose one it lacks), so both forms must survive. The string is not changed.
 */
const addText = (walk: Walk, text: string): void => {
  addScalars(walk, text);
  addScalars(walk, text.normalize('NFC'));
  addScalars(walk, text.normalize('NFD'));
};

/** One rich-text node's own contribution: a text node's string, or a field node's name. */
function visit(walk: Walk, node: Json): void {
  const type = field(node, 'type');
  const marker = typeof type === 'string' && Object.hasOwn(LIST_MARKERS, type) ? LIST_MARKERS[type] : undefined;
  if (marker !== undefined) addText(walk, marker);
  const text = field(node, 'text');
  const attrs = field(node, 'attrs');
  if (type === 'text' && typeof text === 'string') addText(walk, text);
  if (type === 'field' && isObject(attrs)) walk.fields.add(String(field(attrs, 'name')));
}

/** Rich-text text nodes and fields at any depth of one record (labels, notes and nested content included). */
function collect(walk: Walk, value: unknown, depth = 0): void {
  if (depth > MAX_DEPTH) {
    walk.unbounded ??= 'record nesting exceeds the inventory walk';
    return;
  }
  const children = Array.isArray(value) ? value : isObject(value) ? Object.values(value) : [];
  if (isObject(value)) visit(walk, value);
  for (const child of children) collect(walk, child, depth + 1);
}

const ofType = (records: readonly Json[], type: string): readonly Json[] => records.filter((r) => field(r, 'type') === type);
const named = (records: readonly Json[], type: string, key: string): string[] => ofType(records, type).map((r) => String(field(r, key) ?? ''));
/** Generated fields with a complete, finite set of values; `date` and unknown fields have none. */
const FIELD_VALUES: { readonly [name: string]: (records: readonly Json[]) => readonly string[] } = {
  page: () => [DIGITS],
  pageCount: () => [DIGITS],
  screenName: (records) => named(records, 'screen', 'name'),
  title: (records) => named(records, 'document', 'title'),
};

/** Every field's possible values; today's renderer also draws a field literally as {{name}}, so that is kept too. */
function fieldValues(walk: Walk, records: readonly Json[]): void {
  for (const name of walk.fields) {
    addText(walk, `{{${name}}}`);
    const values = Object.hasOwn(FIELD_VALUES, name) ? FIELD_VALUES[name] : undefined;
    if (values) for (const text of values(records)) addText(walk, text);
    else walk.unbounded ??= `the ${name} field has no finite set of values`;
  }
}

/**
 * Every Unicode scalar the document's screens can render with a document font: rich text in elements, connector
 * labels and notes, and the finite values of generated fields. The strings are read, never normalized. A custom
 * renderer (a component or unknown element kind) or an unbounded field makes the inventory `unbounded`.
 * @public
 */
export function glyphInventory(doc: DocumentFile): GlyphInventory {
  const records = Object.values(doc.records) as readonly Json[];
  const walk: Walk = { chars: new Set(), fields: new Set() };
  for (const record of records) {
    const type = field(record, 'type');
    if (type === 'element' && !KNOWN_KINDS.has(String(field(record, 'kind'))))
      return { status: 'unbounded', reason: `a ${String(field(record, 'kind'))} element may render text of its own` };
    if (type === 'element' || type === 'screen') collect(walk, record);
  }
  fieldValues(walk, records);
  if (walk.unbounded) return { status: 'unbounded', reason: walk.unbounded };
  return { status: 'complete', codepoints: [...walk.chars].sort((a, b) => a - b) };
}
