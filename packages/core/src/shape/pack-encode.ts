// One encoder and validator for every declarative shape pack (M18.108, ADR-0196): first-party packs (`@fluxion/sdk`
// `buildShapePackFiles`) and imported collections (`@fluxion/format` `importedShapePack`) give the same bytes for the same pack.
// Canonical JSON (keys sorted at every depth), category slugs from any category text, SHA-256 of each category file, and the
// index and every category validated by the pack parsers under the caller's content policy. Pure: core's synchronous SHA-256.
import { type Diagnostic, err, ok, type Result } from '@fluxion/schema';
import { sha256Hex } from '../hash/sha256.js';
import { utf8 } from '../hash/stable-id.js';
import type { ShapePackCredit, ShapePackIndex, ShapePackLicensePolicy } from './pack-types.js';
import { parseShapePackCategory, parseShapePackIndex } from './pack-validation.js';
import { parseShapeDef, type ShapeDef } from './shape-def.js';

/**
 * A pack to encode: index metadata, credits and its definitions with display names, in index order. A
 * definition's `category` may be any text; the encoder turns it into a slug.
 *
 * @public
 */
export type ShapePackDraft = {
  /** Pack namespace; every definition id is `<id>:<name>`. */
  readonly id: string;
  /** Exact semantic version. */
  readonly version: string;
  /** Display name. */
  readonly name: string;
  /** Default SPDX expression. */
  readonly license: string;
  /** Pack attribution. */
  readonly attribution: string;
  /** Source credits covering every definition (ADR-0050). */
  readonly credits: readonly ShapePackCredit[];
  /** Definitions in index order, each with its display name. */
  readonly definitions: readonly {
    /** Library display name. */
    readonly name: string;
    /** The definition. */
    readonly def: ShapeDef;
  }[];
};

/**
 * An encoded, validated pack: its files by pack-relative path (`index.json`, `categories/<slug>.json`), the
 * parsed index, and every definition as stored (category set to its slug), in index order, which is draft
 * order; each category file holds its definitions in that order.
 *
 * @public
 */
export type EncodedShapePack = {
  /** Canonical file bytes by pack-relative path; `index.json` first, then categories in order of first use. */
  readonly files: ReadonlyMap<string, Uint8Array>;
  /** The validated index. */
  readonly index: ShapePackIndex;
  /** Every definition as stored, in index order. */
  readonly definitions: readonly ShapeDef[];
};

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

/**
 * `value` as canonical JSON text: object keys sorted by code unit at every depth, 2-space indent, LF line
 * ends, a trailing newline, `-0` as `0`, `undefined` fields dropped.
 *
 * @public
 */
export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(sorted(value), null, 2)}\n`;
}

const problem = (path: string, message: string): Diagnostic => ({ code: 'FLX_PACK_INVALID', severity: 'error', path, message });
const UNCATEGORIZED = 'uncategorized';
const slugOf = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

/**
 * One slug per distinct category text, in first-seen order: a text that is already a slug keeps it; texts that
 * slug alike (`Charts & Graphs`, `Charts Graphs`) or to nothing (non-Latin names) are numbered, never merged.
 */
function slugsOf(categories: readonly (string | undefined)[]): Map<string | undefined, string> {
  const slugs = new Map<string | undefined, string>([[undefined, UNCATEGORIZED]]);
  const used = new Set([UNCATEGORIZED]);
  for (const name of categories) {
    if (slugs.has(name)) continue;
    const base = slugOf(name ?? '') || 'category';
    let slug = base === UNCATEGORIZED ? `${base}-2` : base;
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
    slugs.set(name, slug);
    used.add(slug);
  }
  return slugs;
}

/** Every definition with its category slug, parsed and in the namespace, in draft order. */
function stored(draft: ShapePackDraft): Result<{ def: ShapeDef; name: string }[], readonly Diagnostic[]> {
  const slugs = slugsOf(draft.definitions.map(({ def }) => def.category));
  const out: { def: ShapeDef; name: string }[] = [];
  for (const [i, { def: raw, name }] of draft.definitions.entries()) {
    const def = parseShapeDef({ ...raw, category: slugs.get(raw.category) as string }, ['definitions', i, 'def']);
    if (!def.ok) return def;
    if (!def.value.id.startsWith(`${draft.id}:`)) return err([problem(`/definitions/${i}/def/id`, 'definition is outside the pack namespace')]);
    out.push({ def: def.value, name });
  }
  return out.length ? ok(out) : err([problem('/definitions', 'a pack needs at least one definition')]);
}

/**
 * Encode `draft` as a declarative pack (ADR-0048, ADR-0196) and validate every file it writes under
 * `licensePolicy`. Refuses an empty pack, ids outside the namespace, invalid definitions and rights the policy
 * does not permit; nothing is partial. The same draft always gives the same bytes.
 *
 * @public
 */
export function encodeShapePack(draft: ShapePackDraft, licensePolicy: ShapePackLicensePolicy): Result<EncodedShapePack, readonly Diagnostic[]> {
  const members = stored(draft);
  if (!members.ok) return members;
  const groups = new Map<string, ShapeDef[]>();
  for (const { def } of members.value) groups.set(def.category as string, [...(groups.get(def.category as string) ?? []), def]);
  const categoryFiles = new Map<string, Uint8Array>();
  const envelopes = new Map<string, unknown>();
  const descriptors: Record<string, { path: string; sha256: string }> = {};
  for (const [slug, definitions] of groups) {
    const path = `categories/${slug}.json`;
    const envelope = { formatVersion: '1.0', definitions };
    const bytes = utf8(canonicalJson(envelope));
    categoryFiles.set(path, bytes);
    envelopes.set(slug, envelope);
    descriptors[slug] = { path, sha256: sha256Hex(bytes) };
  }
  const index = parseShapePackIndex(
    {
      format: 'fluxion-shape-pack',
      formatVersion: '1.0',
      id: draft.id,
      version: draft.version,
      name: draft.name,
      license: draft.license,
      attribution: draft.attribution,
      categories: descriptors,
      definitions: members.value.map(({ def, name }) => ({ id: def.id, name, keywords: def.keywords ?? [], category: def.category as string })),
      credits: draft.credits,
    },
    licensePolicy,
  );
  if (!index.ok) return index;
  for (const [slug, envelope] of envelopes) {
    const category = parseShapePackCategory(envelope, index.value, slug, licensePolicy);
    if (!category.ok) return err(category.error.map((d) => ({ ...d, path: `/categories/${slug}${d.path}` })));
  }
  const files = new Map<string, Uint8Array>([['index.json', utf8(canonicalJson(index.value))], ...categoryFiles]);
  return ok({ files, index: index.value, definitions: members.value.map((m) => m.def) });
}
