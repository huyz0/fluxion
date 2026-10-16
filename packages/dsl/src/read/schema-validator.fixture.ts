// A validator for the JSON Schema keywords the FluxScript schema uses, for tests (no schema library is a dependency of this package).
export type Json = { readonly [keyword: string]: unknown };

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const typeOf = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

type Check = (schema: Json, value: unknown, ok: (s: Json, v: unknown) => boolean) => boolean;

/** The scalar keywords: const, enum, type, pattern. */
const scalar: Check = (s, v) =>
  (!('const' in s) || s['const'] === v) &&
  (!Array.isArray(s['enum']) || s['enum'].includes(v)) &&
  (s['type'] === undefined || ([s['type']].flat() as string[]).includes(typeOf(v))) &&
  (typeof v !== 'string' || typeof s['pattern'] !== 'string' || new RegExp(s['pattern']).test(v));

/** The combinators: not, anyOf. */
const combined: Check = (s, v, ok) => (!isObject(s['not']) || !ok(s['not'], v)) && (!Array.isArray(s['anyOf']) || s['anyOf'].some((x) => ok(x as Json, v)));

/** Items of an array. */
const items: Check = (s, v, ok) => !Array.isArray(v) || !isObject(s['items']) || v.every((item) => ok(s['items'] as Json, item));

/** The size and required-key keywords of an object. */
const shape: Check = (s, v) => {
  if (!isObject(v)) return true;
  const n = Object.keys(v).length;
  const min = s['minProperties'];
  const max = s['maxProperties'];
  return list(s['required']).every((k) => typeof k === 'string' && k in v) && (typeof min !== 'number' || n >= min) && (typeof max !== 'number' || n <= max);
};

/** Property names and values of an object. */
const members: Check = (s, v, ok) => {
  if (!isObject(v)) return true;
  const props = (isObject(s['properties']) ? s['properties'] : {}) as { [k: string]: Json };
  const extra = s['additionalProperties'];
  const names = s['propertyNames'];
  return Object.keys(v).every((k) => {
    if (isObject(names) && !ok(names, k)) return false;
    if (k in props) return ok(props[k] as Json, v[k]);
    return extra === false ? false : !isObject(extra) || ok(extra, v[k]);
  });
};

const CHECKS: readonly Check[] = [scalar, combined, items, shape, members];

/** Whether `value` is valid against the schema `root`; a `$ref` resolves in the root's `$defs`. */
export function validAgainst(root: Json, value: unknown): boolean {
  const defs = (root['$defs'] ?? {}) as { [name: string]: Json };
  const ok = (schema: Json, v: unknown): boolean => {
    const ref = schema['$ref'];
    if (typeof ref === 'string') return ok(defs[ref.replace('#/$defs/', '')] as Json, v);
    return CHECKS.every((check) => check(schema, v, ok));
  };
  return ok(root, value);
}
