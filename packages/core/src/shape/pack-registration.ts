import { type Diagnostic, err, ok, type Result } from '@fluxion/schema';
import type { Disposable, Registry } from '../registry.js';
import { type ArtworkFontBinding, artworkFontAlias } from './artwork-fonts.js';
import type { ShapePackSubset11, VersionedShapePackSubset } from './pack-font-types.js';
import { parseVersionedShapePackSubset } from './pack-font-validation.js';
import type { ShapePackLicensePolicy, ShapePackSubset } from './pack-types.js';
import { parseShapePackSubset } from './pack-validation.js';
import type { ShapeDef } from './shape-def.js';

const problem = (message: string): Diagnostic => ({ code: 'FLX_PACK_INVALID', severity: 'error', path: '/shapePacks', message });

function preflight<P extends VersionedShapePackSubset = ShapePackSubset>(
  registry: Registry<string, ShapeDef>,
  inputs: readonly unknown[],
  policy: ShapePackLicensePolicy,
  parse: (input: unknown, policy: ShapePackLicensePolicy) => Result<P, readonly Diagnostic[]> = parseShapePackSubset as never,
): Result<readonly P[], readonly Diagnostic[]> {
  const packs: P[] = [];
  const namespaces = new Set<string>();
  const existing = registry.list();
  for (const input of inputs) {
    const parsed = parse(input, policy);
    if (!parsed.ok) return parsed;
    const pack = parsed.value;
    if (namespaces.has(pack.id)) return err([problem(`duplicate saved namespace ${pack.id}`)]);
    if (existing.some(([id]) => id.startsWith(`${pack.id}:`) || registry.source(id) === pack.id))
      return err([problem(`namespace ${pack.id} is already registered; installed and saved versions cannot be mixed`)]);
    namespaces.add(pack.id);
    packs.push(pack);
  }
  return ok(packs);
}

/**
 * Validate and register saved geometry in a document-scoped registry under an explicit policy.
 * Existing namespaces are refused even for disjoint IDs or the same source; versions are never
 * inferred from registry ownership. Failure rolls back only newly inserted definitions. Hosts
 * must not expose the document registry until this synchronous operation succeeds.
 * @public
 */
export function registerShapePackSubsets(
  registry: Registry<string, ShapeDef>,
  inputs: readonly unknown[],
  policy: ShapePackLicensePolicy,
): Result<Disposable, readonly Diagnostic[]> {
  const inserted: Disposable[] = [];
  const dispose = () => {
    for (const item of inserted) item.dispose();
  };
  try {
    const checked = preflight(registry, inputs, policy);
    if (!checked.ok) return checked;
    for (const pack of checked.value) {
      for (const def of pack.definitions) {
        const added = registry.register(def.id, def, pack.id);
        if (!added.ok) {
          dispose();
          return err([added.error]);
        }
        inserted.push(added.value);
      }
    }
    return ok({ dispose });
  } catch {
    dispose();
    return err([problem('saved shape registration failed')]);
  }
}

/**
 * The checks {@link registerVersionedShapePackSubsets} makes before any effect: each input parsed as a
 * 1.0 or 1.1 subset under `policy`, no namespace twice and none already in `registry`. Pure; a host
 * runs it before loading any artwork font, so a refused pack never touches the page. Malformed input
 * is diagnostics, never a throw.
 * @public
 */
export function checkVersionedShapePackSubsets(
  registry: Registry<string, ShapeDef>,
  inputs: readonly unknown[],
  policy: ShapePackLicensePolicy,
): Result<readonly VersionedShapePackSubset[], readonly Diagnostic[]> {
  try {
    return Array.isArray(inputs) ? preflight(registry, inputs, policy, parseVersionedShapePackSubset) : err([problem('saved packs must be an array')]);
  } catch {
    return err([problem('saved shape packs could not be checked')]);
  }
}

/** The exact bytes a host must register before {@link registerVersionedShapePackSubsets}. @public */
export type ArtworkFontRequirement = {
  /** Lowercase SHA-256 of the exact bytes. */
  readonly sha256: string;
  /** Exact byte length. */
  readonly size: number;
  /** Static weight of the bound faces. */
  readonly weight: number;
  /** Static style of the bound faces. */
  readonly style: 'normal' | 'italic';
  /** The private family to register the bytes under. */
  readonly alias: string;
};

/** Per-definition alias bindings of one validated 1.1 subset; a definition without text has none. */
function bindingsOf(pack: ShapePackSubset11): Map<string, ArtworkFontBinding[]> {
  const resources = new Map(pack.fontResources.map((r) => [r.id, r]));
  const faces = new Map(pack.fontFaces.map((f) => [f.id, f]));
  const result = new Map<string, ArtworkFontBinding[]>();
  for (const { definitionId, faceIds } of pack.definitionFonts) {
    const bound: ArtworkFontBinding[] = [];
    for (const faceId of faceIds) {
      const face = faces.get(faceId);
      const resource = face && resources.get(face.resource);
      if (face && resource)
        bound.push({ family: face.family, weight: face.weight, style: face.style, sha256: resource.sha256, alias: artworkFontAlias(resource.sha256) });
    }
    if (bound.length) result.set(definitionId, bound);
  }
  return result;
}

const isV11 = (pack: VersionedShapePackSubset): pack is ShapePackSubset11 => pack.formatVersion === '1.1';

/**
 * The distinct exact fonts that validated subsets bind, one per byte identity, sorted by hash.
 * Pure: a host acquires and registers the bytes, then registers the subsets.
 * @public
 */
export function artworkFontRequirements(packs: readonly VersionedShapePackSubset[]): readonly ArtworkFontRequirement[] {
  const found = new Map<string, ArtworkFontRequirement>();
  for (const pack of packs.filter(isV11)) {
    const used = new Set([...bindingsOf(pack).values()].flat().map((b) => b.sha256));
    for (const r of pack.fontResources) {
      const face = pack.fontFaces.find((f) => f.resource === r.id);
      if (used.has(r.sha256) && face && !found.has(r.sha256))
        found.set(r.sha256, { sha256: r.sha256, size: r.size, weight: face.weight, style: face.style, alias: artworkFontAlias(r.sha256) });
    }
  }
  return [...found.values()].sort((a, b) => (a.sha256 < b.sha256 ? -1 : a.sha256 > b.sha256 ? 1 : 0));
}

type Add = <V>(registry: Registry<string, V>, id: string, value: V, source: string) => boolean;

/** Insert one pack's geometry and bindings; the refusal, or undefined. */
function insertPack(pack: VersionedShapePackSubset, registries: ArtworkShapeRegistries, add: Add): string | undefined {
  const bindings = isV11(pack) ? bindingsOf(pack) : new Map<string, ArtworkFontBinding[]>();
  for (const def of pack.definitions) {
    if (!add(registries.shapeDefs, def.id, def, pack.id)) return `saved shape ${def.id} could not be registered`;
    const bound = bindings.get(def.id);
    if (bound && !add(registries.artworkFonts, def.id, bound, pack.id)) return `artwork fonts of ${def.id} could not be registered`;
  }
  return undefined;
}

/** The registries a versioned registration writes: canonical geometry and renderer-facing bindings. @public */
export type ArtworkShapeRegistries = {
  /** Canonical definitions, unchanged by aliasing. */
  readonly shapeDefs: Registry<string, ShapeDef>;
  /** Alias bindings by definition id, read by renderers only. */
  readonly artworkFonts: Registry<string, readonly ArtworkFontBinding[]>;
};

/**
 * Validate and register saved 1.0 and 1.1 subsets (ADR-0192). Every byte identity a 1.1 definition
 * binds must be in `registered`, the fonts the host has already loaded under their aliases; a
 * missing one refuses everything, so text never falls back to an ordinary face. Geometry stays
 * canonical; bindings go to `artworkFonts`. Atomic like {@link registerShapePackSubsets}.
 * @public
 */
export function registerVersionedShapePackSubsets(
  registries: ArtworkShapeRegistries,
  inputs: readonly unknown[],
  policy: ShapePackLicensePolicy,
  registered: ReadonlySet<string>,
): Result<Disposable, readonly Diagnostic[]> {
  const inserted: Disposable[] = [];
  const dispose = () => {
    for (const item of inserted) item.dispose();
  };
  const add: Add = (registry, id, value, source) => {
    const added = registry.register(id, value, source);
    if (added.ok) inserted.push(added.value);
    else dispose();
    return added.ok;
  };
  try {
    const checked = preflight(registries.shapeDefs, inputs, policy, parseVersionedShapePackSubset);
    if (!checked.ok) return checked;
    const missing = artworkFontRequirements(checked.value).filter((f) => !registered.has(f.sha256));
    if (missing.length) return err(missing.map((f) => problem(`artwork font ${f.sha256} is not registered; its text cannot be drawn without it`)));
    for (const pack of checked.value) {
      // the first refusal stops: add() has already rolled back everything inserted
      const refused = insertPack(pack, registries, add);
      if (refused !== undefined) return err([problem(refused)]);
    }
    return ok({ dispose });
  } catch {
    dispose();
    return err([problem('saved shape registration failed')]);
  }
}
