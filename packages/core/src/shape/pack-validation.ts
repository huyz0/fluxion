import { type Diagnostic, err, jsonPointer, ok, type Result } from '@fluxion/schema';
import { categoryEnvelopeSchema, shapePackIndexSchema } from './pack-schema.js';
import type { ShapePackCategory, ShapePackDefinitionEntry, ShapePackIndex, ShapePackLicensePolicy } from './pack-types.js';
import { parseShapeDef, type ShapeDef } from './shape-def.js';

type At = readonly (string | number)[];
const problem = (path: At, message: string): Diagnostic => ({ code: 'FLX_PACK_INVALID', severity: 'error', path: jsonPointer(path), message });
const issues = (items: readonly { path: readonly PropertyKey[]; message: string }[]): Diagnostic[] =>
  items.map((item) =>
    problem(
      item.path.map((p) => (typeof p === 'symbol' ? String(p) : p)),
      item.message,
    ),
  );
function licenseProblem(value: string, policy: ShapePackLicensePolicy, path: At): Diagnostic[] {
  try {
    if (typeof policy === 'function' && policy(value) === true) return [];
  } catch {
    /* A failed policy cannot authorize a pack. */
  }
  return [problem(path, 'license is not permitted by the supplied content policy')];
}
function categoryProblems(index: ShapePackIndex): Diagnostic[] {
  const out: Diagnostic[] = [];
  if (Object.keys(index.categories).length === 0) out.push(problem(['categories'], 'at least one category is required'));
  for (const [slug, entry] of Object.entries(index.categories)) {
    if (entry.path !== `categories/${slug}.json`) out.push(problem(['categories', slug, 'path'], 'path must exactly name this category'));
  }
  const seen = new Set<string>();
  index.definitions.forEach((def, i) => {
    if (seen.has(def.id)) out.push(problem(['definitions', i, 'id'], 'duplicate definition ID'));
    seen.add(def.id);
    if (!def.id.startsWith(`${index.id}:`)) out.push(problem(['definitions', i, 'id'], 'definition belongs to another namespace'));
    if (!Object.hasOwn(index.categories, def.category)) out.push(problem(['definitions', i, 'category'], 'category is not indexed'));
  });
  return out;
}
function creditProblems(index: ShapePackIndex, policy: ShapePackLicensePolicy): Diagnostic[] {
  const out = licenseProblem(index.license, policy, ['license']);
  const ids = new Set(index.definitions.map((d) => d.id));
  const credits = new Set<string>();
  const covered = new Set<string>();
  let global = false;
  index.credits.forEach((credit, i) => {
    if (credits.has(credit.id)) out.push(problem(['credits', i, 'id'], 'duplicate credit ID'));
    credits.add(credit.id);
    out.push(...licenseProblem(credit.license, policy, ['credits', i, 'license']));
    if (credit.definitionIds === undefined) global = true;
    const scoped = new Set<string>();
    credit.definitionIds?.forEach((id, j) => {
      if (!ids.has(id) || scoped.has(id)) out.push(problem(['credits', i, 'definitionIds', j], 'credit ID is unknown or duplicated'));
      scoped.add(id);
      covered.add(id);
    });
  });
  if (!global)
    index.definitions.forEach((def, i) => {
      if (!covered.has(def.id)) out.push(problem(['definitions', i, 'id'], 'definition has no source credit'));
    });
  return out;
}

/**
 * Parse strict metadata and source credits under an explicit content license policy. No I/O or registration occurs.
 * Unknown versions, invalid membership, missing credit coverage and rejected licenses return diagnostics.
 * @public
 */
export function parseShapePackIndex(input: unknown, licensePolicy: ShapePackLicensePolicy): Result<ShapePackIndex, readonly Diagnostic[]> {
  const parsed = shapePackIndexSchema.safeParse(input);
  if (!parsed.success) return err(issues(parsed.error.issues));
  const errors = [...categoryProblems(parsed.data), ...creditProblems(parsed.data, licensePolicy)];
  return errors.length ? err(errors) : ok(parsed.data);
}

function metadataProblems(def: ShapeDef, entry: ShapePackDefinitionEntry | undefined, category: string, at: At): Diagnostic[] {
  if (!entry) return [problem([...at, 'id'], 'definition is not assigned to this category')];
  const out: Diagnostic[] = [];
  if (def.category !== undefined && def.category !== category) out.push(problem([...at, 'category'], 'definition category disagrees with index'));
  if (def.keywords !== undefined && JSON.stringify([...def.keywords].sort()) !== JSON.stringify([...entry.keywords].sort()))
    out.push(problem([...at, 'keywords'], 'definition keywords disagree with index'));
  return out;
}

/**
 * Validate a complete category and its index atomically. Original-byte hash verification belongs to the loader.
 * Every definition uses the existing geometry/expression parser and every override receives the supplied policy.
 * No accepted subset is returned on failure. No definitions are registered by this function.
 * @public
 */
export function parseShapePackCategory(
  input: unknown,
  index: unknown,
  category: string,
  licensePolicy: ShapePackLicensePolicy,
): Result<ShapePackCategory, readonly Diagnostic[]> {
  const metadata = parseShapePackIndex(index, licensePolicy);
  if (!metadata.ok) return metadata;
  if (!Object.hasOwn(metadata.value.categories, category)) return err([problem(['category'], 'category is not indexed')]);
  const envelope = categoryEnvelopeSchema.safeParse(input);
  if (!envelope.success) return err(issues(envelope.error.issues));
  const errors: Diagnostic[] = [];
  const definitions: ShapeDef[] = [];
  const entries = new Map(metadata.value.definitions.filter((entry) => entry.category === category).map((entry) => [entry.id, entry]));
  const seen = new Set<string>();
  envelope.data.definitions.forEach((raw, i) => {
    const at = ['definitions', i];
    const def = parseShapeDef(raw, at);
    if (!def.ok) {
      errors.push(...def.error);
      return;
    }
    if (seen.has(def.value.id)) errors.push(problem([...at, 'id'], 'duplicate category definition'));
    seen.add(def.value.id);
    errors.push(...metadataProblems(def.value, entries.get(def.value.id), category, at));
    if (def.value.license !== undefined) errors.push(...licenseProblem(def.value.license, licensePolicy, [...at, 'license']));
    definitions.push(def.value);
  });
  for (const entry of metadata.value.definitions) {
    if (entry.category === category && !seen.has(entry.id)) errors.push(problem(['definitions'], `missing indexed definition ${entry.id}`));
  }
  return errors.length ? err(errors) : ok({ formatVersion: '1.0', definitions });
}
