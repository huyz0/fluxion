// Canonical document JSON (FR-DOC-001, NFR-REL-005): one byte sequence per document, on every OS.
// Keys sorted by code unit at every depth (integer-like keys such as "10" come first in numeric
// order: JS object semantics, still one order per document), geometry numbers rounded to 1e-3
// (08-file-format §4), -0 written as 0, 2-space indent, LF line ends, a trailing newline. Arrays
// keep their order (it is meaningful). All other numbers are written exactly (FR-DOC-005).
import { type Diagnostic, diagnostic, jsonPointer } from './diagnostics.js';
import { type DocumentFile, documentFileSchema, SCHEMA_VERSION } from './document-file.js';
import type { FluxError } from './errors.js';
import { migrate } from './migrate.js';
import { repair } from './repair.js';
import { err, ok, type Result } from './result.js';
import { isValid, validate } from './validate.js';

/**
 * Round a number to the canonical 1e-3 grid; `-0` becomes `0`. Magnitudes of 1e12 and more are
 * kept as they are (the grid is finer than their precision), so rounding is idempotent.
 *
 * @public
 */
export function canonicalNumber(n: number): number {
  // at |n| ≥ 1e12 the 1e-3 grid is below double precision: rounding would drift on every save,
  // and past ~1.8e305 n × 1000 overflows to Infinity; such numbers are kept as they are (M2.11 review)
  if (!(Math.abs(n) < 1e12)) return n === 0 ? 0 : n;
  const r = Math.round(n * 1000) / 1000;
  return r === 0 ? 0 : r;
}

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

/** The canonical form of a JSON value: sorted keys, rounded numbers; `undefined` fields dropped. */
function canonical(value: unknown): Json {
  if (typeof value === 'number') return value === 0 ? 0 : value;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((v: unknown) => (v === undefined ? null : canonical(v)));
  // what remains of a JSON value is an object (functions, symbols and bigints do not occur in parsed JSON)
  const obj = value as { readonly [key: string]: unknown };
  // no prototype: `out["__proto__"] = …` on a plain {} would hit the prototype setter and drop
  // the key, while JSON.parse makes it an own property (M2.11 review F1)
  const out: { [key: string]: Json } = Object.create(null);
  for (const key of Object.keys(obj).sort()) if (obj[key] !== undefined) out[key] = canonical(obj[key]);
  return out;
}

/**
 * Serialize a document to canonical JSON. Serializing the same document twice, or a document and
 * its parsed canonical form, gives identical bytes.
 *
 * @public
 */
export function serializeDocument(doc: DocumentFile): string {
  const records: { [id: string]: unknown } = Object.create(null);
  for (const [id, record] of Object.entries(doc.records)) records[id] = roundGeometry(record);
  return `${JSON.stringify(canonical({ ...doc, records }), null, 2)}\n`;
}

type Fields = { readonly [key: string]: unknown };
const isObject = (v: unknown): v is Fields => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `obj` with its numeric `keys` on the 1e-3 grid; other keys (unknown data) untouched. */
function roundKeys(obj: unknown, keys: readonly string[]): unknown {
  if (!isObject(obj)) return obj;
  const out: { [key: string]: unknown } = Object.create(null);
  for (const [k, v] of Object.entries(obj)) out[k] = keys.includes(k) && typeof v === 'number' ? canonicalNumber(v) : v;
  return out;
}

const XY = ['x', 'y'];
const BOX = ['x', 'y', 'w', 'h'];

/**
 * A record with its geometry on the 1e-3 grid: element transform (x, y, w, h, rot), free
 * connector ends, waypoints and label offsets; screen size and viewport. Every other number, in
 * unknown fields and plugin data too, is written exactly as given (FR-DOC-005; M2.9 review r2).
 */
function roundGeometry(record: unknown): unknown {
  if (!isObject(record)) return record;
  if (record['type'] === 'screen') return roundScreen(record);
  return record['type'] === 'element' ? roundElement(record) : record;
}

function roundScreen(record: Fields): Fields {
  const r: { [key: string]: unknown } = { ...record };
  if (record['size'] !== undefined) r['size'] = roundKeys(record['size'], ['w', 'h']);
  if (record['viewport'] !== undefined) r['viewport'] = roundKeys(record['viewport'], BOX);
  return r;
}

function roundElement(record: Fields): Fields {
  const r: { [key: string]: unknown } = { ...record };
  if (record['transform'] !== undefined) r['transform'] = roundKeys(record['transform'], [...BOX, 'rot']);
  for (const end of ['freeSource', 'freeTarget']) if (record[end] !== undefined) r[end] = roundKeys(record[end], XY);
  const route = record['route'];
  if (isObject(route) && Array.isArray(route['waypoints'])) r['route'] = { ...route, waypoints: route['waypoints'].map((p: unknown) => roundKeys(p, XY)) };
  const labels = record['labels'];
  if (Array.isArray(labels))
    r['labels'] = labels.map((l: unknown) => (isObject(l) && l['offset'] !== undefined ? { ...l, offset: roundKeys(l['offset'], XY) } : l));
  return r;
}

/**
 * A parsed, valid document and its warnings.
 *
 * @public
 */
export type ParsedDocument = {
  /** The parsed document (deep-equal to the input, ADR-0142). */
  readonly document: DocumentFile;
  /** Warnings and info from validation. */
  readonly diagnostics: readonly Diagnostic[];
};

/**
 * Why a document could not be parsed: `DOCUMENT_JSON_INVALID` (not JSON) or `DOCUMENT_INVALID`
 * (validation errors), with every diagnostic.
 *
 * @public
 */
export type DocumentError = FluxError & {
  /** Every problem found, errors and warnings. */
  readonly diagnostics: readonly Diagnostic[];
  /**
   * The records that had no error, after migration and repair, so a damaged file still opens in
   * part (NFR-REL-002); `null` when the text is not JSON, too deep, or not a migratable document.
   */
  readonly salvaged: DocumentFile | null;
};

/**
 * Deepest JSON nesting `parseDocument` accepts; deeper input is `FLX_JSON_TOO_DEEP` (hostile
 * nesting would otherwise overflow the stack in repair and serialization, NFR-REL-002).
 *
 * @public
 */
export const MAX_JSON_DEPTH: number = 256;

/** Whether `value` nests deeper than `max`, checked without recursion. */
function tooDeep(value: unknown, max: number): boolean {
  const stack: [unknown, number][] = [[value, 1]];
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    const [v, depth] = item;
    if (typeof v !== 'object' || v === null) continue;
    if (depth > max) return true;
    for (const child of Object.values(v)) stack.push([child, depth + 1]);
  }
  return false;
}

/** Record keys that have an error at or below `/records/<key>`. */
const brokenKeys = (diagnostics: readonly Diagnostic[]): Set<string> =>
  new Set(diagnostics.flatMap((d) => (d.severity === 'error' && d.path.startsWith('/records/') ? [d.path.split('/')[2] ?? ''] : [])));

/**
 * `records` minus the broken ones; a dropped binding goes to repair as dangling, so its connector
 * end becomes free instead of leaving a valid connector with an end that is neither bound nor
 * free (M2.14 review r2 F1).
 */
function withoutBroken(records: { readonly [key: string]: unknown }, broken: ReadonlySet<string>): { [id: string]: unknown } {
  const kept: { [id: string]: unknown } = Object.create(null);
  for (const [key, record] of Object.entries(records)) {
    if (!isObject(record)) continue;
    if (!broken.has(jsonPointer([key]).slice(1))) kept[key] = record;
    else if (record['type'] === 'binding') kept[key] = { id: key, type: 'binding', connectorId: record['connectorId'], end: record['end'] };
  }
  return kept;
}

/**
 * The records that stay valid on their own: drop every record with an error, repair and validate
 * again (a dropped screen takes its elements, a dropped element its bindings), to a fixed point
 * bounded by the record count (M2.14 review F2). Document-level errors may remain.
 */
function salvage(doc: unknown, diagnostics: readonly Diagnostic[]): DocumentFile | null {
  if (!isObject(doc)) return null;
  const initial = doc['records'];
  if (!isObject(initial)) return null;
  let records: { readonly [key: string]: unknown } = initial;
  let broken = brokenKeys(diagnostics);
  for (let pass = 0; broken.size > 0 && pass <= Object.keys(records).length; pass++) {
    const kept = withoutBroken(records, broken);
    const fixed = repair({ ...doc, schemaVersion: SCHEMA_VERSION, records: kept }).document;
    records = fixed.records;
    broken = brokenKeys(validate(fixed));
  }
  const typed = documentFileSchema.safeParse({ ...doc, schemaVersion: SCHEMA_VERSION, records });
  return typed.success ? typed.data : null;
}

/**
 * Parse `.flux.json` text: JSON syntax, migration to the current schema version, lenient repair
 * (reported as `FLX_REPAIRED_*` warnings), then {@link validate}. Never throws; expected failures
 * are a `Result` error (coding-typescript rule 10).
 *
 * @public
 */
export function parseDocument(text: string): Result<ParsedDocument, DocumentError> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e: unknown) {
    const reason = e instanceof Error ? e.message : String(e);
    const diagnostics = [diagnostic('FLX_JSON_INVALID', [], `not valid JSON: ${reason}`)];
    return err({ code: 'DOCUMENT_JSON_INVALID', message: `not valid JSON: ${reason}`, diagnostics, salvaged: null });
  }
  if (tooDeep(value, MAX_JSON_DEPTH)) {
    const diagnostics = [diagnostic('FLX_JSON_TOO_DEEP', [], `JSON is nested deeper than ${MAX_JSON_DEPTH} levels`)];
    return err({ code: 'DOCUMENT_JSON_INVALID', message: diagnostics[0]?.message ?? '', diagnostics, salvaged: null });
  }
  // older versions are migrated, recoverable problems repaired (each reported), then validated
  const migrated = migrate(value);
  const repaired = migrated.ok ? repair(migrated.value.document) : null;
  const doc = repaired === null ? value : repaired.document;
  const diagnostics = [...(repaired?.diagnostics ?? []), ...validate(doc)];
  const invalid = (): Result<ParsedDocument, DocumentError> =>
    err({
      code: 'DOCUMENT_INVALID',
      message: `${diagnostics.filter((d) => d.severity === 'error').length} error(s)`,
      diagnostics,
      salvaged: migrated.ok ? salvage(doc, diagnostics) : null,
    });
  if (!isValid(diagnostics)) return invalid();
  // validate() accepted it, so the schema does too; parsing returns the input unchanged (ADR-0142)
  const typed = documentFileSchema.safeParse(doc);
  return typed.success ? ok({ document: typed.data, diagnostics }) : invalid();
}
