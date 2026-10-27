import { type Diagnostic, err, jsonPointer, ok, type Result } from '@fluxion/schema';
import { artworkFontLicenses, artworkFontProfiles } from './artwork-font-profile.js';
import { normalizeSvgArtworkFonts } from './artwork-fonts.js';
import type {
  ShapePackCategory11,
  ShapePackFontCredit,
  ShapePackFontResource,
  ShapePackFonts,
  ShapePackIndex11,
  ShapePackSubset11,
  VersionedShapePackCategory,
  VersionedShapePackIndex,
  VersionedShapePackSubset,
} from './pack-font-types.js';
import { category11Schema, index11Schema, subset11Schema } from './pack-schema.js';
import type { ShapePackLicensePolicy } from './pack-types.js';
import { parseShapePackCategory, parseShapePackIndex, parseShapePackSubset } from './pack-validation.js';
import type { ShapeDef } from './shape-def.js';

type At = readonly (string | number)[];
type Fonts = ShapePackFonts<ShapePackFontResource & { readonly path?: string }>;
const problem = (path: At, message: string): Diagnostic => ({ code: 'FLX_PACK_INVALID', severity: 'error', path: jsonPointer(path), message });
const issues = (items: readonly { path: readonly PropertyKey[]; message: string }[]): Diagnostic[] =>
  items.map((item) =>
    problem(
      item.path.map((p) => (typeof p === 'symbol' ? String(p) : p)),
      item.message,
    ),
  );
const versionOf = (input: unknown): unknown => (typeof input === 'object' && input !== null && 'formatVersion' in input ? input.formatVersion : undefined);
const FONT_KEYS = ['fontResources', 'fontFaces', 'definitionFonts', 'fontCredits'] as const;
/** The 1.0 view of a parsed 1.1 envelope, so the unchanged 1.0 rules check its shared fields. */
function legacyView<T extends object>(value: T): Record<string, unknown> {
  const out: Record<string, unknown> = { ...value, formatVersion: '1.0' };
  for (const key of FONT_KEYS) delete out[key];
  return out;
}
function permitted(license: string, policy: ShapePackLicensePolicy): boolean {
  try {
    return artworkFontLicenses.includes(license) && typeof policy === 'function' && policy(license) === true;
  } catch {
    return false;
  }
}

function resourceProblems(fonts: Fonts, distribution: boolean): Diagnostic[] {
  const out: Diagnostic[] = [];
  const ids = new Set<string>();
  const hashes = new Set<string>();
  fonts.fontResources.forEach((r, i) => {
    const at = ['fontResources', i];
    if (ids.has(r.id)) out.push(problem([...at, 'id'], 'duplicate font resource ID'));
    if (hashes.has(r.sha256)) out.push(problem([...at, 'sha256'], 'one font hash must be one resource'));
    ids.add(r.id);
    hashes.add(r.sha256);
    const profile = artworkFontProfiles[r.profile];
    if (r.sha256 !== profile.sha256 || r.size !== profile.size || r.mime !== profile.mime)
      out.push(problem(at, 'font resource does not match its supported profile'));
    if (distribution && r.path !== `fonts/${r.sha256}.woff2`) out.push(problem([...at, 'path'], 'path must be fonts/<sha256>.woff2'));
  });
  return out;
}

function faceProblems(fonts: Fonts): Diagnostic[] {
  const out: Diagnostic[] = [];
  const resources = new Map(fonts.fontResources.map((r) => [r.id, r]));
  const ids = new Set<string>();
  const keys = new Set<string>();
  fonts.fontFaces.forEach((f, i) => {
    const at = ['fontFaces', i];
    if (ids.has(f.id)) out.push(problem([...at, 'id'], 'duplicate font face ID'));
    ids.add(f.id);
    const key = `${f.family.toLowerCase()}\n${f.weight}\n${f.style}`;
    if (keys.has(key)) out.push(problem([...at, 'family'], 'duplicate face family, weight and style'));
    keys.add(key);
    const resource = resources.get(f.resource);
    if (!resource) out.push(problem([...at, 'resource'], 'face names an unknown resource'));
    else {
      const profile = artworkFontProfiles[resource.profile];
      if (f.weight !== profile.weight || f.style !== profile.style) out.push(problem(at, 'face disagrees with its resource profile'));
    }
  });
  return out;
}

function bindingProblems(fonts: Fonts, definitions: ReadonlySet<string>): Diagnostic[] {
  const out: Diagnostic[] = [];
  const faces = new Map(fonts.fontFaces.map((f) => [f.id, f]));
  const bound = new Set<string>();
  const usedFaces = new Set<string>();
  fonts.definitionFonts.forEach((b, i) => {
    const at = ['definitionFonts', i];
    if (!definitions.has(b.definitionId) || bound.has(b.definitionId))
      out.push(problem([...at, 'definitionId'], 'binding names an unknown or already bound definition'));
    bound.add(b.definitionId);
    const own = new Set<string>();
    const resources = new Set<string>();
    b.faceIds.forEach((id, j) => {
      const face = faces.get(id);
      if (!face || own.has(id)) out.push(problem([...at, 'faceIds', j], 'face is unknown or duplicated'));
      else if (resources.has(face.resource)) out.push(problem([...at, 'faceIds', j], 'one definition cannot bind two faces to one resource'));
      own.add(id);
      usedFaces.add(id);
      if (face) resources.add(face.resource);
    });
  });
  const usedResources = new Set(fonts.fontFaces.filter((f) => usedFaces.has(f.id)).map((f) => f.resource));
  fonts.fontFaces.forEach((f, i) => {
    if (!usedFaces.has(f.id)) out.push(problem(['fontFaces', i, 'id'], 'face is not used by any definition'));
  });
  fonts.fontResources.forEach((r, i) => {
    if (!usedResources.has(r.id)) out.push(problem(['fontResources', i, 'id'], 'resource is not used by any face'));
  });
  return out;
}

/** Resources each bound definition uses, through its faces. */
function usage(fonts: Fonts): Map<string, Set<string>> {
  const faces = new Map(fonts.fontFaces.map((f) => [f.id, f.resource]));
  return new Map(fonts.definitionFonts.map((b) => [b.definitionId, new Set(b.faceIds.flatMap((id) => (faces.has(id) ? [faces.get(id) ?? ''] : [])))]));
}

type Scope = { readonly uses: ReadonlyMap<string, ReadonlySet<string>>; readonly resources: ReadonlySet<string>; readonly covered: Set<string> };
/** One credit's scope: unique known resources, and bound definitions that each use a listed resource. */
function scopeProblems(c: ShapePackFontCredit, at: At, { uses, resources, covered }: Scope): Diagnostic[] {
  const out: Diagnostic[] = [];
  const listed = new Set<string>();
  c.resourceIds.forEach((id, j) => {
    if (!resources.has(id) || listed.has(id)) out.push(problem([...at, 'resourceIds', j], 'credit resource is unknown or duplicated'));
    listed.add(id);
  });
  const defs = new Set<string>();
  c.definitionIds.forEach((id, j) => {
    const used = [...(uses.get(id) ?? [])].filter((r) => listed.has(r));
    if (!uses.has(id) || defs.has(id)) out.push(problem([...at, 'definitionIds', j], 'credit definition is unbound or duplicated'));
    else if (!used.length) out.push(problem([...at, 'definitionIds', j], 'definition uses none of the credited resources'));
    for (const r of used) covered.add(`${id}\n${r}`);
    defs.add(id);
  });
  c.resourceIds.forEach((id, j) => {
    if (![...defs].some((d) => uses.get(d)?.has(id))) out.push(problem([...at, 'resourceIds', j], 'no credited definition uses this resource'));
  });
  return out;
}

function creditProblems(fonts: Fonts, policy: ShapePackLicensePolicy): Diagnostic[] {
  const out: Diagnostic[] = [];
  const uses = usage(fonts);
  const resources = new Set(fonts.fontResources.map((r) => r.id));
  const ids = new Set<string>();
  const covered = new Set<string>();
  fonts.fontCredits.forEach((c, i) => {
    const at = ['fontCredits', i];
    if (ids.has(c.id)) out.push(problem([...at, 'id'], 'duplicate font credit ID'));
    ids.add(c.id);
    if (!permitted(c.license, policy)) out.push(problem([...at, 'license'], 'font license is not permitted for artwork fonts'));
    out.push(...scopeProblems(c, at, { uses, resources, covered }));
  });
  fonts.definitionFonts.forEach((b, i) => {
    for (const r of uses.get(b.definitionId) ?? [])
      if (!covered.has(`${b.definitionId}\n${r}`)) out.push(problem(['definitionFonts', i], `resource ${r} has no font credit for this definition`));
  });
  return out;
}

function fontProblems(fonts: Fonts, definitions: ReadonlySet<string>, policy: ShapePackLicensePolicy, distribution: boolean): Diagnostic[] {
  return [...resourceProblems(fonts, distribution), ...faceProblems(fonts), ...bindingProblems(fonts, definitions), ...creditProblems(fonts, policy)];
}

/** Each definition's artwork text closure must equal its binding exactly, under the shared normalizer. */
function closureProblems(fonts: Fonts, definitions: readonly ShapeDef[], at: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  const faces = new Map(fonts.fontFaces.map((f) => [f.id, f]));
  const hashes = new Map(fonts.fontResources.map((r) => [r.id, r.sha256]));
  const bindings = new Map(fonts.definitionFonts.map((b) => [b.definitionId, b]));
  definitions.forEach((def, i) => {
    const path = [at, i, 'artwork'];
    const bound = (bindings.get(def.id)?.faceIds ?? []).flatMap((id) => {
      const face = faces.get(id);
      const sha256 = face && hashes.get(face.resource);
      return face && sha256 ? [{ family: face.family, weight: face.weight, style: face.style, sha256 }] : [];
    });
    if (!def.artwork) {
      if (bound.length) out.push(problem(path, 'definition without artwork has a font binding'));
      return;
    }
    const checked = normalizeSvgArtworkFonts(def.artwork.root, { fonts: bound });
    if (checked.error) out.push(problem(path, `artwork text is not bound to exact faces: ${checked.error}`));
    else if (checked.fonts.length !== bound.length) out.push(problem(path, 'font binding names faces the artwork text does not use'));
  });
  return out;
}

/**
 * Parse a pack index of version 1.0 or 1.1. Version 1.0 uses `parseShapePackIndex` unchanged.
 * Version 1.1 also validates exact resource, face, binding and scoped font-credit closure without
 * geometry or I/O; artwork text closure is checked when a category is acquired.
 * @public
 */
export function parseVersionedShapePackIndex(input: unknown, licensePolicy: ShapePackLicensePolicy): Result<VersionedShapePackIndex, readonly Diagnostic[]> {
  return versionOf(input) === '1.1' ? parseIndex11(input, licensePolicy) : parseShapePackIndex(input, licensePolicy);
}
function parseIndex11(input: unknown, licensePolicy: ShapePackLicensePolicy): Result<ShapePackIndex11, readonly Diagnostic[]> {
  const parsed = index11Schema.safeParse(input);
  if (!parsed.success) return err(issues(parsed.error.issues));
  const legacy = parseShapePackIndex(legacyView(parsed.data), licensePolicy);
  const errors = [...(legacy.ok ? [] : legacy.error), ...fontProblems(parsed.data, new Set(parsed.data.definitions.map((d) => d.id)), licensePolicy, true)];
  return errors.length ? err(errors) : ok(parsed.data);
}

/**
 * Validate a complete category against its index; both must declare the same version.
 * Version 1.1 additionally requires every definition's artwork text closure to equal its binding.
 * No accepted subset is returned on failure and nothing is registered.
 * @public
 */
export function parseVersionedShapePackCategory(
  input: unknown,
  index: unknown,
  category: string,
  licensePolicy: ShapePackLicensePolicy,
): Result<VersionedShapePackCategory, readonly Diagnostic[]> {
  if (versionOf(input) !== versionOf(index)) return err([problem(['formatVersion'], 'category version differs from its index')]);
  if (versionOf(index) !== '1.1') return parseShapePackCategory(input, index, category, licensePolicy);
  const metadata = parseIndex11(index, licensePolicy);
  if (!metadata.ok) return metadata;
  const envelope = category11Schema.safeParse(input);
  if (!envelope.success) return err(issues(envelope.error.issues));
  const pack = metadata.value;
  const legacy = parseShapePackCategory({ ...envelope.data, formatVersion: '1.0' }, legacyView(pack), category, licensePolicy);
  if (!legacy.ok) return legacy;
  const errors = closureProblems(pack, legacy.value.definitions, 'definitions');
  const value: ShapePackCategory11 = { formatVersion: '1.1', definitions: legacy.value.definitions };
  return errors.length ? err(errors) : ok(value);
}

/**
 * Parse a saved subset of version 1.0 or 1.1. Version 1.0 uses `parseShapePackSubset` unchanged.
 * Version 1.1 validates every included definition's exact font closure and scoped font credits;
 * an empty font closure is valid and is never downgraded to 1.0.
 * @public
 */
export function parseVersionedShapePackSubset(input: unknown, licensePolicy: ShapePackLicensePolicy): Result<VersionedShapePackSubset, readonly Diagnostic[]> {
  if (versionOf(input) !== '1.1') return parseShapePackSubset(input, licensePolicy);
  const parsed = subset11Schema.safeParse(input);
  if (!parsed.success) return err(issues(parsed.error.issues));
  const legacy = parseShapePackSubset(legacyView(parsed.data), licensePolicy);
  if (!legacy.ok) return legacy;
  const definitions = legacy.value.definitions;
  const errors = [
    ...fontProblems(parsed.data, new Set(definitions.map((d) => d.id)), licensePolicy, false),
    ...closureProblems(parsed.data, definitions, 'definitions'),
  ];
  const value: ShapePackSubset11 = { ...parsed.data, definitions };
  return errors.length ? err(errors) : ok(value);
}
