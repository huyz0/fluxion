import {
  parseShapeDef,
  parseShapePackIndex,
  parseShapePackSubset,
  type ShapeDef,
  type ShapePackCredit,
  type ShapePackDefinitionEntry,
  type ShapePackIndex,
  type ShapePackLicensePolicy,
  type ShapePackSubset,
} from '@fluxion/core';
import { type Diagnostic, type DocumentFile, err, ok, type Result } from '@fluxion/schema';
import { encodeBase64 } from './base64.js';
import { canonicalJson } from './canonical-json.js';
import type { ContentHasher } from './flux-writer.js';
import { encodeUtf8 } from './utf8.js';

/** Explicit provenance for used geometry; embedded sources need no reconstructed index. @public */
export type ShapePackSourceData =
  | {
      /** Distribution metadata plus host-resolved geometry. */
      readonly kind: 'distribution';
      /** Complete validated metadata; unused entries remain available for credit validation. */
      readonly index: ShapePackIndex;
      /** Resolved definitions, potentially a partial collection; every supplied definition is checked. */
      readonly definitions: readonly ShapeDef[];
    }
  | {
      /** Previously saved geometry; no distribution index is required. */
      readonly kind: 'embedded';
      /** Saved source geometry and rights declarations. */
      readonly subset: ShapePackSubset;
    };

/** Data-only lock for a canonical saved subset (ADR-0183). @public */
export type ShapePackDataLock = {
  /** Data-only discriminator, never executable plugin code. */
  readonly kind: 'declarative-shapes';
  /** Pack namespace. */
  readonly id: string;
  /** Exact pinned semantic version. */
  readonly version: string;
  /** Saved envelope version. */
  readonly packFormat: '1.0';
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
};

/** Atomic prepared data; writer/loader integration is a separate boundary. @public */
export type PreparedShapePacks = {
  /** Deterministically ordered locks for only used namespaces. */
  readonly locks: readonly ShapePackDataLock[];
  /** Canonical saved subset bytes, keyed by the corresponding lock entry. */
  readonly extraEntries: ReadonlyMap<string, Uint8Array>;
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

function distribution(input: Record<string, unknown>, policy: ShapePackLicensePolicy): Result<ShapePackSubset, readonly Diagnostic[]> {
  const index = parseShapePackIndex(input['index'], policy);
  if (!index.ok) return index;
  if (!Array.isArray(input['definitions'])) return err([problem('/definitions', 'resolved definitions must be an array')]);
  const metadata = new Map(index.value.definitions.map((d) => [d.id, d]));
  const definitions: ShapeDef[] = [];
  const seen = new Set<string>();
  for (const [i, raw] of input['definitions'].entries()) {
    const def = parseShapeDef(raw, ['definitions', i]);
    if (!def.ok) return def;
    const entry = metadata.get(def.value.id);
    if (!entry || seen.has(def.value.id)) return err([problem(`/definitions/${i}/id`, 'definition must be indexed exactly once')]);
    if (metadataMismatch(def.value, entry)) return err([problem(`/definitions/${i}`, 'definition metadata disagrees with its index')]);
    if (!permittedOverride(def.value, policy)) return err([problem(`/definitions/${i}/license`, 'definition license is not permitted')]);
    seen.add(def.value.id);
    definitions.push(def.value);
  }
  const { format, formatVersion, id, version, license, attribution, credits } = index.value;
  return ok({ format, formatVersion, id, version, license, attribution, credits, definitions });
}

function sourceSubset(input: unknown, policy: ShapePackLicensePolicy): Result<ShapePackSubset, readonly Diagnostic[]> {
  if (!object(input)) return err([problem('', 'source must be an object')]);
  if (input['kind'] === 'distribution') return distribution(input, policy); // kind-switch-allow: closed source-provenance union, not an element kind
  if (input['kind'] === 'embedded') return parseShapePackSubset(input['subset'], policy); // kind-switch-allow: closed source-provenance union, not an element kind
  return err([problem('/kind', 'unsupported shape-pack source kind')]);
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

type Pending = { readonly id: string; readonly version: string; readonly entry: string; readonly bytes: Uint8Array };
function collectSources(inputs: readonly ShapePackSourceData[], policy: ShapePackLicensePolicy): Result<Map<string, ShapePackSubset>, readonly Diagnostic[]> {
  if (!Array.isArray(inputs)) return err([problem('/sources', 'sources must be an array')]);
  const sources = new Map<string, ShapePackSubset>();
  for (const [i, input] of inputs.entries()) {
    const parsed = sourceSubset(input, policy);
    if (!parsed.ok) return err(parsed.error.map((d) => ({ ...d, path: `/sources/${i}${d.path}` })));
    if (sources.has(parsed.value.id)) return err([problem(`/sources/${i}`, 'duplicate source namespace')]);
    sources.set(parsed.value.id, parsed.value);
  }
  return ok(sources);
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

function pendingEntries(
  document: DocumentFile,
  inputs: readonly ShapePackSourceData[],
  builtinIds: ReadonlySet<string>,
  policy: ShapePackLicensePolicy,
): Result<Pending[], readonly Diagnostic[]> {
  const parsed = collectSources(inputs, policy);
  if (!parsed.ok) return parsed;
  const selected = usedIds(document, builtinIds);
  if (!selected.ok) return selected;
  const sources = parsed.value;
  const used = selected.value;
  const available = new Set<string>([...sources.values()].flatMap((source) => source.definitions.map((def) => def.id)));
  for (const id of used) if (!available.has(id)) return err([problem('/document/records', `unresolved definition ${id}`)]);
  const entries: Pending[] = [];
  for (const source of [...sources.values()].sort(byId)) {
    const definitions = source.definitions.filter((d) => used.has(d.id)).sort(byId);
    if (!definitions.length) continue;
    const subset = parseShapePackSubset({ ...source, definitions, credits: usedCredits(source.credits, used) }, policy);
    if (!subset.ok) return subset;
    entries.push({
      id: source.id,
      version: source.version,
      entry: `plugins/${source.id}@${source.version}/defs.json`,
      bytes: encodeUtf8(canonicalJson(subset.value)),
    });
  }
  return ok(entries);
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
    const pending = pendingEntries(document, sources, new Set(options.builtinIds), policy);
    if (!pending.ok) return pending;
    const locks: ShapePackDataLock[] = [];
    const extraEntries = new Map<string, Uint8Array>();
    for (const entry of pending.value) {
      const hex = await hash(entry.bytes.slice());
      if (!/^[0-9a-f]{64}$/.test(hex)) return err([problem('/hasher', 'expected a lowercase hexadecimal SHA-256 digest')]);
      const digest = Uint8Array.from({ length: 32 }, (_, i) => Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16));
      locks.push({
        kind: 'declarative-shapes',
        id: entry.id,
        version: entry.version,
        packFormat: '1.0',
        entry: entry.entry,
        integrity: `sha256-${encodeBase64(digest)}`,
      });
      extraEntries.set(entry.entry, entry.bytes);
    }
    return ok({ locks, extraEntries });
  } catch {
    return err([problem('', 'shape-pack preparation failed; check the source, policy and hash port')]);
  }
}
