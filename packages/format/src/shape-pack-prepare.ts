import {
  parseShapeDef,
  parseVersionedShapePackIndex,
  parseVersionedShapePackSubset,
  type ShapeDef,
  type ShapePackCredit,
  type ShapePackDefinitionEntry,
  type ShapePackFontResource,
  type ShapePackLicensePolicy,
  type ShapePackSubset,
  type ShapePackSubset11,
  type VersionedShapePackIndex,
  type VersionedShapePackSubset,
} from '@fluxion/core';
import { type Diagnostic, type DocumentFile, err, ok, type Result } from '@fluxion/schema';
import { encodeBase64 } from './base64.js';
import { canonicalJson } from './canonical-json.js';
import type { ContentHasher } from './flux-write-types.js';
import { encodeUtf8 } from './utf8.js';

/** Explicit provenance for used geometry; embedded sources need no reconstructed index. @public */
export type ShapePackSourceData =
  | {
      /** Distribution metadata plus host-resolved geometry. */
      readonly kind: 'distribution';
      /** Complete validated 1.0 or 1.1 metadata; unused entries remain available for credit validation. */
      readonly index: VersionedShapePackIndex;
      /** Resolved definitions, potentially a partial collection; every supplied definition is checked. */
      readonly definitions: readonly ShapeDef[];
      /** Exact acquired artwork font bytes by lowercase SHA-256; required for every used 1.1 resource. */
      readonly fonts?: ReadonlyMap<string, Uint8Array>;
    }
  | {
      /** Previously saved geometry; no distribution index is required. */
      readonly kind: 'embedded';
      /** Saved 1.0 or 1.1 source geometry and rights declarations. */
      readonly subset: VersionedShapePackSubset;
      /** Exact retained artwork font bytes by lowercase SHA-256, such as a loaded file's assets. */
      readonly fonts?: ReadonlyMap<string, Uint8Array>;
    };

/** Data-only lock for a canonical saved subset (ADR-0183). @public */
export type ShapePackDataLock = {
  /** Data-only discriminator, never executable plugin code. */
  readonly kind: 'declarative-shapes';
  /** Pack namespace. */
  readonly id: string;
  /** Exact pinned semantic version. */
  readonly version: string;
  /** Saved envelope version; 1.1 retains exact artwork fonts (ADR-0192). */
  readonly packFormat: '1.0' | '1.1';
  /** Exact canonical archive path of the definitions. */
  readonly entry: string;
  /** SHA-256 as standard padded base64, prefixed with `sha256-`. */
  readonly integrity: string;
};

/** Explicit host capabilities and content policy for preparation. @public */
export type PrepareShapePacksOptions = {
  /** Builtin definitions need no external geometry; namespaces are never inferred. */
  readonly builtinIds: ReadonlySet<string>;
  /** Required policy for pack, credit and definition licenses. */
  readonly licensePolicy: ShapePackLicensePolicy;
  /** Trusted SHA-256 port; receives a copy of each canonical entry. */
  readonly hasher: ContentHasher;
  /** IDs unresolved in the loaded document; new unresolved IDs still fail. */
  readonly preservedUnresolvedIds?: ReadonlySet<string>;
};

/** Atomic prepared data; writer/loader integration is a separate boundary. @public */
export type PreparedShapePacks = {
  /** Warnings the host must show when preserving explicitly loaded unresolved references. */
  readonly diagnostics: readonly Diagnostic[];
  /** Deterministically ordered locks for only used namespaces. */
  readonly locks: readonly ShapePackDataLock[];
  /** Canonical saved subset bytes, keyed by the corresponding lock entry. */
  readonly extraEntries: ReadonlyMap<string, Uint8Array>;
  /** Verified bytes of every font resource the used 1.1 subsets retain, by SHA-256; one hash is one binary. */
  readonly fontAssets: ReadonlyMap<string, Uint8Array>;
};

const problem = (path: string, message: string): Diagnostic => ({ code: 'FLX_PACK_INVALID', severity: 'error', path, message });
const object = (input: unknown): input is Record<string, unknown> => typeof input === 'object' && input !== null && !Array.isArray(input);
const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function metadataMismatch(def: ShapeDef, entry: ShapePackDefinitionEntry): boolean {
  return (
    (def.category !== undefined && def.category !== entry.category) ||
    (def.keywords !== undefined && JSON.stringify([...def.keywords].sort()) !== JSON.stringify([...entry.keywords].sort()))
  );
}

function permittedOverride(def: ShapeDef, policy: ShapePackLicensePolicy): boolean {
  return def.license === undefined || policy(def.license) === true;
}

/** A resource as retained in a saved subset: its distribution path is dropped, the asset is addressed by hash. */
const retained = ({ id, sha256, size, mime, profile }: ShapePackFontResource): ShapePackFontResource => ({ id, sha256, size, mime, profile });

/** Each resolved definition, parsed and checked against its index entry and the policy. */
function resolvedDefinitions(
  raws: readonly unknown[],
  index: VersionedShapePackIndex,
  policy: ShapePackLicensePolicy,
): Result<ShapeDef[], readonly Diagnostic[]> {
  const metadata = new Map(index.definitions.map((d) => [d.id, d]));
  const definitions: ShapeDef[] = [];
  const seen = new Set<string>();
  for (const [i, raw] of raws.entries()) {
    const def = parseShapeDef(raw, ['definitions', i]);
    if (!def.ok) return def;
    const entry = metadata.get(def.value.id);
    if (!entry || seen.has(def.value.id)) return err([problem(`/definitions/${i}/id`, 'definition must be indexed exactly once')]);
    if (metadataMismatch(def.value, entry)) return err([problem(`/definitions/${i}`, 'definition metadata disagrees with its index')]);
    if (!permittedOverride(def.value, policy)) return err([problem(`/definitions/${i}/license`, 'definition license is not permitted')]);
    seen.add(def.value.id);
    definitions.push(def.value);
  }
  return ok(definitions);
}

function distribution(input: Record<string, unknown>, policy: ShapePackLicensePolicy): Result<VersionedShapePackSubset, readonly Diagnostic[]> {
  const index = parseVersionedShapePackIndex(input['index'], policy);
  if (!index.ok) return index;
  const raws = input['definitions'];
  if (!Array.isArray(raws)) return err([problem('/definitions', 'resolved definitions must be an array')]);
  const resolved = resolvedDefinitions(raws, index.value, policy);
  if (!resolved.ok) return resolved;
  const pack = index.value;
  const { format, id, version, license, attribution, credits } = pack;
  const header = { format, id, version, license, attribution, credits, definitions: resolved.value };
  if (pack.formatVersion === '1.0') return ok({ ...header, formatVersion: '1.0' });
  const { fontFaces, definitionFonts, fontCredits } = pack;
  return ok({ ...header, formatVersion: '1.1', fontResources: pack.fontResources.map(retained), fontFaces, definitionFonts, fontCredits });
}

/**
 * The saved subset of a pack source with every definition it holds, checked under `policy`, or why it is not one: what a host
 * registers right after an import, before any save (M18.175).
 * @public
 */
export function shapePackSubsetOf(source: ShapePackSourceData, policy: ShapePackLicensePolicy): Result<VersionedShapePackSubset, readonly Diagnostic[]> {
  return object(source) ? parsedSource(source, policy) : err([problem('', 'source must be an object')]);
}

type Source = { readonly subset: VersionedShapePackSubset; readonly fonts: ReadonlyMap<string, Uint8Array> };
/** Owned copies of host font bytes, captured before any await. */
function fontsOf(input: Record<string, unknown>): ReadonlyMap<string, Uint8Array> | undefined {
  const fonts = input['fonts'];
  if (fonts === undefined) return new Map();
  if (!(fonts instanceof Map)) return undefined;
  const out = new Map<string, Uint8Array>();
  for (const [hash, bytes] of fonts) {
    if (typeof hash !== 'string' || !(bytes instanceof Uint8Array)) return undefined;
    out.set(hash, bytes.slice());
  }
  return out;
}
function parsedSource(input: Record<string, unknown>, policy: ShapePackLicensePolicy): Result<VersionedShapePackSubset, readonly Diagnostic[]> {
  if (input['kind'] === 'distribution') return distribution(input, policy); // kind-switch-allow: closed source-provenance union, not an element kind
  if (input['kind'] === 'embedded') return parseVersionedShapePackSubset(input['subset'], policy); // kind-switch-allow: closed source-provenance union, not an element kind
  return err([problem('/kind', 'unsupported shape-pack source kind')]);
}
function sourceSubset(input: unknown, policy: ShapePackLicensePolicy): Result<Source, readonly Diagnostic[]> {
  if (!object(input)) return err([problem('', 'source must be an object')]);
  const fonts = fontsOf(input);
  if (!fonts) return err([problem('/fonts', 'fonts must map SHA-256 strings to bytes')]);
  const subset = parsedSource(input, policy);
  return subset.ok ? ok({ subset: subset.value, fonts }) : subset;
}

function usedCredits(credits: readonly ShapePackCredit[], used: ReadonlySet<string>): ShapePackCredit[] {
  return credits
    .flatMap((credit) => {
      if (credit.definitionIds === undefined) return [credit];
      const definitionIds = credit.definitionIds.filter((id) => used.has(id)).sort();
      return definitionIds.length ? [{ ...credit, definitionIds }] : [];
    })
    .sort(byId);
}

/** The 1.1 font closure of only the used definitions: unreachable bindings, faces, resources and credit scopes are pruned. */
function usedFonts(source: ShapePackSubset11, used: ReadonlySet<string>): Omit<ShapePackSubset11, keyof ShapePackSubset | 'formatVersion'> {
  const definitionFonts = source.definitionFonts.filter((b) => used.has(b.definitionId)).sort((a, b) => (a.definitionId < b.definitionId ? -1 : 1));
  const faceIds = new Set(definitionFonts.flatMap((b) => b.faceIds));
  const fontFaces = source.fontFaces.filter((f) => faceIds.has(f.id)).sort(byId);
  const resourceOf = new Map(fontFaces.map((f) => [f.id, f.resource]));
  const resources = new Set(fontFaces.map((f) => f.resource));
  const uses = new Map(definitionFonts.map((b) => [b.definitionId, new Set(b.faceIds.map((id) => resourceOf.get(id)))]));
  const fontCredits = source.fontCredits
    .flatMap((credit) => {
      const listed = credit.resourceIds.filter((id) => resources.has(id));
      const definitionIds = credit.definitionIds.filter((id) => listed.some((r) => uses.get(id)?.has(r))).sort();
      const resourceIds = listed.filter((r) => definitionIds.some((id) => uses.get(id)?.has(r))).sort();
      return definitionIds.length && resourceIds.length ? [{ ...credit, resourceIds, definitionIds }] : [];
    })
    .sort(byId);
  return { fontResources: source.fontResources.filter((r) => resources.has(r.id)).sort(byId), fontFaces, definitionFonts, fontCredits };
}

type Pending = {
  readonly id: string;
  readonly version: string;
  readonly packFormat: '1.0' | '1.1';
  readonly entry: string;
  readonly bytes: Uint8Array;
  readonly fonts: readonly { readonly resource: ShapePackFontResource; readonly bytes: Uint8Array | undefined }[];
};
function collectSources(inputs: readonly ShapePackSourceData[], policy: ShapePackLicensePolicy): Result<Map<string, Source>, readonly Diagnostic[]> {
  if (!Array.isArray(inputs)) return err([problem('/sources', 'sources must be an array')]);
  const sources = new Map<string, Source>();
  for (const [i, input] of inputs.entries()) {
    const parsed = sourceSubset(input, policy);
    if (!parsed.ok) return err(parsed.error.map((d) => ({ ...d, path: `/sources/${i}${d.path}` })));
    if (sources.has(parsed.value.subset.id)) return err([problem(`/sources/${i}`, 'duplicate source namespace')]);
    sources.set(parsed.value.subset.id, parsed.value);
  }
  return ok(sources);
}

/** The used subset of one source, validated in its own format version; never downgraded. */
function usedSubset(
  subset: VersionedShapePackSubset,
  used: ReadonlySet<string>,
  policy: ShapePackLicensePolicy,
): Result<VersionedShapePackSubset, readonly Diagnostic[]> {
  const definitions = subset.definitions.filter((d) => used.has(d.id)).sort(byId);
  const header = { ...subset, definitions, credits: usedCredits(subset.credits, used) };
  return parseVersionedShapePackSubset(subset.formatVersion === '1.1' ? { ...header, ...usedFonts(subset, used) } : header, policy);
}

function usedIds(document: DocumentFile, builtinIds: ReadonlySet<string>): Result<Set<string>, readonly Diagnostic[]> {
  const used = new Set<string>();
  for (const record of Object.values(document.records)) {
    if (record.type === 'element' && record['kind'] === 'shape') {
      const id = record['defId'];
      if (typeof id !== 'string') return err([problem('/document/records', 'shape has no definition ID')]);
      if (!builtinIds.has(id)) used.add(id);
    }
  }
  return ok(used);
}

/** Every used ID resolves to a source, or was loaded unresolved and is preserved with a warning. */
function checkResolved(
  sources: ReadonlyMap<string, Source>,
  used: ReadonlySet<string>,
  preserved: ReadonlySet<string>,
  diagnostics: Diagnostic[],
): Result<true, readonly Diagnostic[]> {
  const available = new Set<string>([...sources.values()].flatMap((source) => source.subset.definitions.map((def) => def.id)));
  for (const id of [...used].sort()) {
    if (available.has(id)) continue;
    if (!preserved.has(id)) return err([problem('/document/records', `unresolved definition ${id}`)]);
    diagnostics.push({
      code: 'FLX_PACK_UNRESOLVED_PRESERVED',
      severity: 'warning',
      path: '/document/records',
      message: `preserved loaded unresolved definition ${id}; no geometry is available`,
    });
  }
  return ok(true);
}

function pendingEntries(
  document: DocumentFile,
  inputs: readonly ShapePackSourceData[],
  options: {
    readonly builtinIds: ReadonlySet<string>;
    readonly policy: ShapePackLicensePolicy;
    readonly preserved: ReadonlySet<string>;
    readonly diagnostics: Diagnostic[];
  },
): Result<Pending[], readonly Diagnostic[]> {
  const { builtinIds, policy, preserved, diagnostics } = options;
  const parsed = collectSources(inputs, policy);
  if (!parsed.ok) return parsed;
  const selected = usedIds(document, builtinIds);
  if (!selected.ok) return selected;
  const sources = parsed.value;
  const used = selected.value;
  const resolved = checkResolved(sources, used, preserved, diagnostics);
  if (!resolved.ok) return resolved;
  const entries: Pending[] = [];
  for (const { subset: source, fonts } of [...sources.values()].sort((a, b) => byId(a.subset, b.subset))) {
    if (!source.definitions.some((d) => used.has(d.id))) continue;
    const subset = usedSubset(source, used, policy);
    if (!subset.ok) return subset;
    const retainedFonts = subset.value.formatVersion === '1.1' ? subset.value.fontResources : [];
    entries.push({
      id: source.id,
      version: source.version,
      packFormat: subset.value.formatVersion,
      entry: `plugins/${source.id}@${source.version}/defs.json`,
      bytes: encodeUtf8(canonicalJson(subset.value)),
      fonts: retainedFonts.map((resource) => ({ resource, bytes: fonts.get(resource.sha256) })),
    });
  }
  return ok(entries);
}

/** Verify each retained resource's supplied bytes (size and hash) and collect them once per hash. */
async function verifiedFonts(
  entry: Pending,
  hash: (bytes: Uint8Array) => Promise<string>,
  out: Map<string, Uint8Array>,
): Promise<Result<true, readonly Diagnostic[]>> {
  for (const { resource, bytes } of entry.fonts) {
    const exact = bytes !== undefined && bytes.byteLength === resource.size && (await hash(bytes.slice())) === resource.sha256;
    if (!exact || !bytes)
      return err([problem(`/sources/${entry.id}/fonts/${resource.sha256}`, 'exact artwork font bytes are missing or do not match their resource')]);
    out.set(resource.sha256, bytes);
  }
  return ok(true);
}

/**
 * Validate sources and prepare only referenced geometry and applicable credits. All bytes and
 * identity are captured before hashing. Invalid sources/references or failed hashes return
 * diagnostics and no partial output. No registry, network or filesystem effects occur.
 * @public
 */
export async function prepareUsedShapePacks(
  document: DocumentFile,
  sources: readonly ShapePackSourceData[],
  options: PrepareShapePacksOptions,
): Promise<Result<PreparedShapePacks, readonly Diagnostic[]>> {
  try {
    const policy = options.licensePolicy;
    if (typeof policy !== 'function') return err([problem('/licensePolicy', 'an explicit content policy is required')]);
    const hash = options.hasher.sha256.bind(options.hasher);
    const diagnostics: Diagnostic[] = [];
    const pending = pendingEntries(document, sources, {
      builtinIds: new Set(options.builtinIds),
      policy,
      preserved: new Set(options.preservedUnresolvedIds),
      diagnostics,
    });
    if (!pending.ok) return pending;
    const locks: ShapePackDataLock[] = [];
    const extraEntries = new Map<string, Uint8Array>();
    const fontAssets = new Map<string, Uint8Array>();
    for (const entry of pending.value) {
      // Fontless entries hash with no extra await, so the first port call still happens before any yield.
      const fonts = entry.fonts.length ? await verifiedFonts(entry, hash, fontAssets) : ok(true);
      if (!fonts.ok) return fonts;
      const hex = await hash(entry.bytes.slice());
      if (!/^[0-9a-f]{64}$/.test(hex)) return err([problem('/hasher', 'expected a lowercase hexadecimal SHA-256 digest')]);
      const digest = Uint8Array.from({ length: 32 }, (_, i) => Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16));
      locks.push({
        kind: 'declarative-shapes',
        id: entry.id,
        version: entry.version,
        packFormat: entry.packFormat,
        entry: entry.entry,
        integrity: `sha256-${encodeBase64(digest)}`,
      });
      extraEntries.set(entry.entry, entry.bytes);
    }
    return ok({ locks, extraEntries, fontAssets, diagnostics });
  } catch {
    return err([problem('', 'shape-pack preparation failed; check the source, policy and hash port')]);
  }
}
