// One encoder and validator for every declarative shape pack (M18.108, ADR-0196): first-party packs (`@fluxion/sdk`
// `buildShapePackFiles`) and imported collections (`@fluxion/format` `importedShapePack`) give the same bytes for the same pack.
// Canonical JSON (keys sorted at every depth), category slugs from any category text, SHA-256 of each category file, and the
// index and every category validated by the pack parsers under the caller's content policy. Pure: core's synchronous SHA-256.
// A draft with `fonts` encodes as pack 1.1 (ADR-0192): its font metadata in the index and each exact font file, checked against
// its resource, at `fonts/<sha256>.woff2`.
import { type Diagnostic, err, ok, type Result } from '@fluxion/schema';
import { sha256Hex } from '../hash/sha256.js';
import { utf8 } from '../hash/stable-id.js';
import type { ShapePackDistributionFontResource, ShapePackFonts, VersionedShapePackIndex } from './pack-font-types.js';
import { parseVersionedShapePackCategory, parseVersionedShapePackIndex } from './pack-font-validation.js';
import type { ShapePackCredit, ShapePackIndex, ShapePackLicensePolicy } from './pack-types.js';
import { type CategoryEntries, categoryOfIndex } from './pack-validation.js';
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
  /** Exact artwork fonts (ADR-0192): present, the pack encodes as 1.1, even with an empty closure. */
  readonly fonts?: ShapePackDraftFonts;
};

/**
 * The pack 1.1 font metadata of a draft and the exact bytes of each resource, by lowercase SHA-256.
 *
 * @public
 */
export type ShapePackDraftFonts = ShapePackFonts<ShapePackDistributionFontResource> & {
  /** Exact bytes of every resource, by its SHA-256; each must match its resource's hash and size. */
  readonly bytes: ReadonlyMap<string, Uint8Array>;
};

/**
 * An encoded, validated pack: its files by pack-relative path (`index.json`, `categories/<slug>.json`, and for 1.1
 * `fonts/<sha256>.woff2`), the
 * parsed index, and every definition as stored (category set to its slug), in index order, which is draft
 * order; each category file holds its definitions in that order.
 *
 * @public
 */
export type EncodedShapePack = {
  /** Canonical file bytes by pack-relative path; `index.json` first, then categories in order of first use, then fonts by resource. */
  readonly files: ReadonlyMap<string, Uint8Array>;
  /** The validated index, version 1.1 when the draft has fonts. */
  readonly index: VersionedShapePackIndex;
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

/** The font files of a 1.1 draft by their resource paths, or the diagnostics of bytes that are missing or not their resource's. */
function fontFiles(fonts: ShapePackDraftFonts): Result<[string, Uint8Array][], readonly Diagnostic[]> {
  const out: [string, Uint8Array][] = [];
  const errors: Diagnostic[] = [];
  for (const [i, r] of fonts.fontResources.entries()) {
    const bytes = fonts.bytes.get(r.sha256);
    if (bytes === undefined || bytes.byteLength !== r.size || sha256Hex(bytes) !== r.sha256)
      errors.push(problem(`/fonts/fontResources/${i}`, `the bytes of font ${r.id} are missing or do not match its SHA-256 and size`));
    else out.push([r.path, bytes.slice()]);
  }
  const extra = [...fonts.bytes.keys()].filter((sha) => !fonts.fontResources.some((r) => r.sha256 === sha));
  for (const sha of extra) errors.push(problem('/fonts/bytes', `font bytes ${sha} belong to no resource`));
  return errors.length ? err(errors) : ok(out);
}

/** The stored definitions grouped by category slug; linear in their number, each appended to its group once. */
function groupBySlug(members: readonly { def: ShapeDef }[]): Map<string, ShapeDef[]> {
  const groups = new Map<string, ShapeDef[]>();
  for (const { def } of members) {
    const group = groups.get(def.category as string);
    if (group) group.push(def);
    else groups.set(def.category as string, [def]);
  }
  return groups;
}

/** Every written category file validated against the one parsed `index`, with its entries looked up once per slug. */
function checkCategories(
  index: VersionedShapePackIndex,
  envelopes: ReadonlyMap<string, unknown>,
  licensePolicy: ShapePackLicensePolicy,
): Result<true, readonly Diagnostic[]> {
  // a 1.1 category also checks every definition's font closure against its index: that parser validates the index itself
  if (index.formatVersion === '1.1') {
    for (const [slug, envelope] of envelopes) {
      const category = parseVersionedShapePackCategory(envelope, index, slug, licensePolicy);
      if (!category.ok) return err(category.error.map((d) => ({ ...d, path: `/categories/${slug}${d.path}` })));
    }
    return ok(true);
  }
  const legacy: ShapePackIndex = index;
  const bySlug = new Map<string, Map<string, ShapePackIndex['definitions'][number]>>();
  for (const entry of legacy.definitions) {
    const entries = bySlug.get(entry.category) ?? new Map();
    bySlug.set(entry.category, entries.set(entry.id, entry));
  }
  for (const [category, envelope] of envelopes) {
    const entries: CategoryEntries = bySlug.get(category) ?? new Map();
    const checked = categoryOfIndex(envelope, { index: legacy, category, entries }, licensePolicy);
    if (!checked.ok) return err(checked.error.map((d) => ({ ...d, path: `/categories/${category}${d.path}` })));
  }
  return ok(true);
}

/**
 * Encode `draft` as a declarative pack (ADR-0048, ADR-0196) and validate every file it writes under
 * `licensePolicy`. Refuses an empty pack, ids outside the namespace, invalid definitions and rights the policy
 * does not permit; nothing is partial. The same draft always gives the same bytes. A draft with `fonts` is a
 * pack 1.1 (ADR-0192): its index and categories are validated by the 1.1 parsers (exact font closure of each
 * definition's artwork text, scoped font credits) and every resource's bytes must match it.
 *
 * @public
 */
export function encodeShapePack(draft: ShapePackDraft, licensePolicy: ShapePackLicensePolicy): Result<EncodedShapePack, readonly Diagnostic[]> {
  const members = stored(draft);
  if (!members.ok) return members;
  const fonts = draft.fonts === undefined ? ok([] as [string, Uint8Array][]) : fontFiles(draft.fonts);
  if (!fonts.ok) return fonts;
  const formatVersion = draft.fonts === undefined ? '1.0' : '1.1';
  const groups = groupBySlug(members.value);
  const categoryFiles = new Map<string, Uint8Array>();
  const envelopes = new Map<string, unknown>();
  const descriptors: Record<string, { path: string; sha256: string }> = {};
  for (const [slug, definitions] of groups) {
    const path = `categories/${slug}.json`;
    const envelope = { formatVersion, definitions };
    const bytes = utf8(canonicalJson(envelope));
    categoryFiles.set(path, bytes);
    envelopes.set(slug, envelope);
    descriptors[slug] = { path, sha256: sha256Hex(bytes) };
  }
  const metadata =
    draft.fonts === undefined
      ? {}
      : {
          fontResources: draft.fonts.fontResources,
          fontFaces: draft.fonts.fontFaces,
          definitionFonts: draft.fonts.definitionFonts,
          fontCredits: draft.fonts.fontCredits,
        };
  const index = parseVersionedShapePackIndex(
    {
      format: 'fluxion-shape-pack',
      formatVersion,
      id: draft.id,
      version: draft.version,
      name: draft.name,
      license: draft.license,
      attribution: draft.attribution,
      categories: descriptors,
      definitions: members.value.map(({ def, name }) => ({ id: def.id, name, keywords: def.keywords ?? [], category: def.category as string })),
      credits: draft.credits,
      ...metadata,
    },
    licensePolicy,
  );
  if (!index.ok) return index;
  const checked = checkCategories(index.value, envelopes, licensePolicy);
  if (!checked.ok) return checked;
  const files = new Map<string, Uint8Array>([['index.json', utf8(canonicalJson(index.value))], ...categoryFiles, ...fonts.value]);
  return ok({ files, index: index.value, definitions: members.value.map((m) => m.def) });
}
