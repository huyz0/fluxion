// What the patch resolver reads a document through (ADR-0035): an index of its screens, elements and connectors by id, the diagnostics it
// raises, and the reading of the strict patch form as the plain one.
import { type AnyRecord, DIAGNOSTIC_CODES, type Diagnostic, type DiagnosticCode, jsonPointer } from '@fluxion/schema';

/**
 * What a resolved reference points at.
 *
 * @public
 */
export type RefKind = 'screen' | 'element' | 'group' | 'connector';
type DocRecords = { readonly [id: string]: AnyRecord };

type Rec = { readonly [key: string]: unknown };
export type Entry = {
  id: string;
  kind: RefKind;
  slug?: string;
  screen?: string;
  parent?: string;
  ends?: readonly [string, string];
  shape?: string;
  tone?: string;
};

export const diagnostic = (code: DiagnosticCode, path: readonly (string | number)[], message: string, hint?: string): Diagnostic => ({
  code,
  severity: DIAGNOSTIC_CODES[code],
  path: jsonPointer(path),
  message,
  ...(hint === undefined ? {} : { hint }),
});

export const asRec = (v: unknown): Rec | undefined => (typeof v === 'object' && v !== null ? (v as Rec) : undefined);

/** The strict form (ADR-0035 amendment) as the plain one: null for an absent optional is dropped, `{ key, value }` pairs are a record. */
export function normalizeStrictPatch(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeStrictPatch);
  const o = asRec(value);
  if (o === undefined) return value;
  const out: { [key: string]: unknown } = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === null) continue;
    if (k === 'style' && Array.isArray(v) && v.every((p) => asRec(p) !== undefined && 'key' in (p as Rec) && 'value' in (p as Rec)))
      out[k] = Object.fromEntries(v.map((p) => [String((p as Rec)['key']), (p as Rec)['value']]));
    else out[k] = normalizeStrictPatch(v);
  }
  return out;
}

/** The source and target element of each connector, from the bindings. */
function bindingsOf(records: DocRecords): Map<string, { source?: string; target?: string }> {
  const bindings = new Map<string, { source?: string; target?: string }>();
  for (const r of Object.values(records)) {
    const x = r as unknown as Rec;
    if (x['type'] !== 'binding') continue;
    bindings.set(String(x['connectorId']), { ...bindings.get(String(x['connectorId'])), [String(x['end'])]: String(x['elementId']) });
  }
  return bindings;
}

const KINDS: { readonly [kind: string]: RefKind | undefined } = { connector: 'connector', group: 'group' };
const kindOf = (x: Rec): RefKind => KINDS[String(x['kind'])] ?? 'element';
const stringOf = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** An element record as an index entry. */
function elementEntry(x: Rec, bindings: ReturnType<typeof bindingsOf>): Entry {
  const id = String(x['id']);
  const e: Entry = { id, kind: kindOf(x) };
  const [slug, screen, parent, shape] = [stringOf(asRec(x['semantic'])?.['slug']), stringOf(x['screenId']), stringOf(x['parentId']), stringOf(x['defId'])];
  if (slug) e.slug = slug;
  if (screen) e.screen = screen;
  if (parent) e.parent = parent;
  if (shape) e.shape = shape;
  const b = bindings.get(id);
  if (e.kind === 'connector' && b?.source && b.target) e.ends = [b.source, b.target];
  return e;
}

/** The working index: screens, elements and connectors by id, with the slugs and ends a reference is looked up by. */
export function indexOf(records: DocRecords): Map<string, Entry> {
  const index = new Map<string, Entry>();
  const bindings = bindingsOf(records);
  for (const r of Object.values(records)) {
    const x = r as unknown as Rec;
    const id = String(x['id']);
    if (x['type'] === 'screen') {
      const slug = stringOf(asRec(x['meta'])?.['slug']);
      index.set(id, { id, kind: 'screen', ...(slug ? { slug } : {}) });
    } else if (x['type'] === 'element') index.set(id, elementEntry(x, bindings));
  }
  return index;
}
