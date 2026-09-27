// Canonical document JSON (FR-DOC-001, NFR-REL-005): one byte sequence per document, on every OS.
// Keys sorted by code unit at every depth (integer-like keys such as "10" come first in numeric
// order: JS object semantics, still one order per document), numbers rounded to 1e-3 with -0 written as 0, 2-space
// indent, LF line ends, a trailing newline. Arrays keep their order (it is meaningful).
import { type Diagnostic, diagnostic } from './diagnostics.js';
import { type DocumentFile, documentFileSchema } from './document-file.js';
import type { FluxError } from './errors.js';
import { err, ok, type Result } from './result.js';
import { isValid, validate } from './validate.js';

/**
 * Round a number to the canonical 1e-3 grid; `-0` becomes `0`.
 *
 * @public
 */
export function canonicalNumber(n: number): number {
  const r = Math.round(n * 1000) / 1000;
  return r === 0 ? 0 : r;
}

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

/** The canonical form of a JSON value: sorted keys, rounded numbers; `undefined` fields dropped. */
function canonical(value: unknown): Json {
  if (typeof value === 'number') return canonicalNumber(value);
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
  return `${JSON.stringify(canonical(doc), null, 2)}\n`;
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
};

/**
 * Parse `.flux.json` text: JSON syntax, then {@link validate}. Never throws; expected failures are
 * a `Result` error (coding-typescript rule 10).
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
    return err({ code: 'DOCUMENT_JSON_INVALID', message: `not valid JSON: ${reason}`, diagnostics });
  }
  const diagnostics = validate(value);
  const invalid = (): Result<ParsedDocument, DocumentError> =>
    err({ code: 'DOCUMENT_INVALID', message: `${diagnostics.filter((d) => d.severity === 'error').length} error(s)`, diagnostics });
  if (!isValid(diagnostics)) return invalid();
  // validate() accepted it, so the schema does too; parsing returns the input unchanged (ADR-0142)
  const typed = documentFileSchema.safeParse(value);
  return typed.success ? ok({ document: typed.data, diagnostics }) : invalid();
}
