// Document validation (02-document-model §5, FR-DOC-004): structural (each record against the
// schema of its type and kind) then referential. Every problem is reported, never only the first,
// in a deterministic order (records by id).
import type { z } from 'zod';
import { type Diagnostic, type DiagnosticCode, diagnostic } from './diagnostics.js';
import { type AnyRecord, SCHEMA_VERSION, schemaForRecord } from './document-file.js';
import { checkReferences } from './references.js';
import { checkRichText } from './rich-text.js';

type Fields = { readonly [key: string]: unknown };
type Path = readonly (string | number)[];

const isObject = (v: unknown): v is Fields => typeof v === 'object' && v !== null && !Array.isArray(v);
const VERSION = /^(\d+)\.(\d+)$/;
const RICH_TEXT_CODES = new Set<string>(['FLX_TEXT_INVALID', 'FLX_TEXT_UNSAFE_LINK']);

function checkVersion(version: unknown, out: Diagnostic[]): void {
  const m = typeof version === 'string' ? VERSION.exec(version) : null;
  if (m === null) {
    out.push(diagnostic('FLX_VERSION_INVALID', ['schemaVersion'], 'schemaVersion must be a "MAJOR.MINOR" string', `use "${SCHEMA_VERSION}"`));
    return;
  }
  const [major, minor] = [Number(m[1]), Number(m[2])];
  const [curMajor, curMinor] = SCHEMA_VERSION.split('.').map(Number) as [number, number];
  if (major > curMajor)
    out.push(
      diagnostic('FLX_VERSION_UNSUPPORTED', ['schemaVersion'], `schema ${String(version)} is newer than ${SCHEMA_VERSION}`, 'open it with a newer Fluxion'),
    );
  else if (major < curMajor || (major === curMajor && minor < curMinor))
    out.push(
      diagnostic('FLX_VERSION_UNSUPPORTED', ['schemaVersion'], `schema ${String(version)} is older than ${SCHEMA_VERSION}`, 'run migrate() before validate()'),
    );
  else if (minor > curMinor)
    out.push(
      diagnostic('FLX_VERSION_NEWER', ['schemaVersion'], `schema ${String(version)} is a newer minor version; unknown data is kept but not interpreted`),
    );
}

/** A Zod issue as a diagnostic: rich-text errors keep their FLX code, others are FLX_SCHEMA_INVALID. */
function fromIssue(issue: z.core.$ZodIssue, base: Path): Diagnostic {
  const flx = issue.code === 'custom' ? (issue.params as Fields | undefined)?.['flx'] : undefined;
  const code: DiagnosticCode = typeof flx === 'string' && RICH_TEXT_CODES.has(flx) ? (flx as DiagnosticCode) : 'FLX_SCHEMA_INVALID';
  const hint = issue.code === 'invalid_value' ? `expected one of ${issue.values.map((v) => JSON.stringify(v)).join(', ')}` : undefined;
  return diagnostic(code, [...base, ...issue.path.map((p) => (typeof p === 'symbol' ? String(p) : p))], issue.message, hint);
}

/** Rich-text warnings (unknown nodes and marks) of the text fields of a parsed record. */
function richTextWarnings(rec: Fields, base: Path): Diagnostic[] {
  const fields: [Path, unknown][] = [
    [['text'], rec['text']],
    [['notes'], rec['notes']],
  ];
  const labels = rec['labels'];
  if (Array.isArray(labels))
    labels.forEach((l: unknown, i) => {
      fields.push([['labels', i, 'text'], isObject(l) ? l['text'] : undefined]);
    });
  return fields
    .filter(([, v]) => v !== undefined)
    .flatMap(([at, v]) =>
      checkRichText(v)
        .filter((i) => i.severity !== 'error')
        .map((i) => diagnostic(i.code, [...base, ...at, ...i.path], i.message)),
    );
}

function checkRecord(key: string, value: unknown, out: Diagnostic[], parsed: Map<string, AnyRecord>): void {
  const base = ['records', key];
  if (!isObject(value)) {
    out.push(diagnostic('FLX_SCHEMA_INVALID', base, 'a record must be an object with "id" and "type"'));
    return;
  }
  if (value['id'] !== key)
    out.push(diagnostic('FLX_ID_MISMATCH', [...base, 'id'], `record id ${JSON.stringify(value['id'])} differs from its key "${key}"`, `set "id": "${key}"`));
  const { schema, known } = schemaForRecord(value);
  if (!known && value['type'] === 'element')
    out.push(
      diagnostic(
        'FLX_KIND_UNKNOWN',
        [...base, 'kind'],
        `element kind ${JSON.stringify(value['kind'])} is not known to this version; it is kept and shown as a placeholder`,
      ),
    );
  else if (!known)
    out.push(diagnostic('FLX_RECORD_UNKNOWN_TYPE', [...base, 'type'], `record type ${JSON.stringify(value['type'])} is not known to this version; it is kept`));
  const r = schema.safeParse(value);
  if (!r.success) out.push(...r.error.issues.map((issue) => fromIssue(issue, base)));
  // on the raw value: a record with schema errors still reports its rich-text warnings (M2.10 review F1)
  out.push(...richTextWarnings(value, base));
  // referential checks see each record under its map key, so their pointers name /records/<key>
  // even when the id disagrees (M2.10 review F2; the mismatch itself is FLX_ID_MISMATCH above)
  if (r.success) parsed.set(key, { ...r.data, id: key } as AnyRecord);
}

/**
 * Validate a document: structure of every record (by type and kind), then references, singleton,
 * connector ends, sibling indices and slugs. Reports all problems, errors and warnings, as
 * diagnostics with JSON pointers; never throws.
 *
 * @param doc - parsed JSON of a `.flux.json` document (or anything)
 * @returns structural diagnostics in record-id order, then referential ones grouped by check
 * @public
 */
export function validate(doc: unknown): Diagnostic[] {
  if (!isObject(doc)) return [diagnostic('FLX_DOC_NOT_OBJECT', [], 'a document is a JSON object with "schemaVersion" and "records"')];
  const out: Diagnostic[] = [];
  checkVersion(doc['schemaVersion'], out);
  const records = doc['records'];
  if (!isObject(records)) {
    out.push(diagnostic('FLX_RECORDS_INVALID', ['records'], '"records" must be an object keyed by record id'));
    return out;
  }
  const parsed = new Map<string, AnyRecord>();
  const present = new Map<string, Fields>();
  for (const key of Object.keys(records).sort()) {
    const value = records[key];
    if (isObject(value)) present.set(key, { ...value, id: key });
    checkRecord(key, value, out, parsed);
  }
  out.push(...checkReferences(parsed, present));
  return out;
}

/**
 * Whether a list of diagnostics has no errors (warnings and info allowed).
 *
 * @public
 */
export function isValid(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.every((d) => d.severity !== 'error');
}
