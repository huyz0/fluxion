// Canonical JSON for files written beside the document (the token file, the manifest): object keys sorted by code unit at every depth,
// 2-space indent, LF line ends, a trailing newline, `-0` as `0`, `undefined` fields dropped. The document itself is written by
// `serializeDocument` (@fluxion/schema), which also rounds geometry; this one rounds nothing.

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

/** The sorted-key form of a JSON value. */
function sorted(value: unknown): Json {
  if (typeof value === 'number') return value === 0 ? 0 : value;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((v: unknown) => (v === undefined ? null : sorted(v)));
  const obj = value as { readonly [key: string]: unknown };
  // no prototype: assigning "__proto__" on a plain {} would drop the key
  const out: { [key: string]: Json } = Object.create(null);
  for (const key of Object.keys(obj).sort()) if (obj[key] !== undefined) out[key] = sorted(obj[key]);
  return out;
}

/** `value` as canonical JSON text. */
export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(sorted(value), null, 2)}\n`;
}
