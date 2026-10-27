import {
  artworkFontProfiles,
  parseVersionedShapePackCategory,
  parseVersionedShapePackIndex,
  type ShapeDef,
  type ShapePackDefinitionEntry,
  type ShapePackDistributionFontResource,
  type ShapePackFontCredit,
  type ShapePackIndex11,
  type VersionedShapePackIndex,
} from '@fluxion/core';
import { type Diagnostic, err, ok, type Result } from '@fluxion/schema';
import { decode, digest, freezeJson, problem, snapshot } from './pack-bytes.js';
import { capabilities, readCategory, type ShapePackLoaderOptions, searchDefinitions } from './pack-loader.js';

type Failure = readonly Diagnostic[];

/** Bounds of one definition's font acquisition. @public */
export type ArtworkAcquisitionLimits = {
  /** Largest accepted single font resource, in bytes. */
  readonly maxFontBytes: number;
  /** Most faces one definition may bind. */
  readonly maxFaces: number;
  /** Largest total of one definition's distinct font resources, in bytes. */
  readonly maxTotalFontBytes: number;
};

/**
 * Per-acquisition font bounds (ADR-0192). They bound one definition's acquisition, not a pack or document.
 * @public
 */
export const ARTWORK_ACQUISITION_LIMITS: ArtworkAcquisitionLimits = Object.freeze({
  maxFontBytes: 5 * 1024 * 1024,
  maxFaces: 8,
  maxTotalFontBytes: 8 * 1024 * 1024,
});

/** One verified exact face with an owned copy of its bytes. @public */
export type AcquiredArtworkFont = {
  /** Pack-local face ID. */
  readonly faceId: string;
  /** Original source family; hosts register it under a private alias, never as a theme font. */
  readonly family: string;
  /** Static weight. */
  readonly weight: 400;
  /** Static style. */
  readonly style: 'normal';
  /** Pack-local resource ID. */
  readonly resourceId: string;
  /** Verified lowercase SHA-256 of `bytes`. */
  readonly sha256: string;
  /** Supported profile the bytes match. */
  readonly profile: 'inter-latin-400-ascii';
  /** Bytes owned by this consumer; changing them affects no other acquisition. */
  readonly bytes: Uint8Array;
};

/** A verified definition with its exact face closure and the font credits that cover it. @public */
export type AcquiredArtworkDefinition = {
  /** Validated, frozen geometry and artwork. */
  readonly definition: ShapeDef;
  /** Exact bound faces in binding order; empty for text-free or 1.0 definitions. */
  readonly fonts: readonly AcquiredArtworkFont[];
  /** Font credits naming this definition, preserved verbatim. */
  readonly fontCredits: readonly ShapePackFontCredit[];
};

/** A cancellation flag the host may set at any time; an `AbortSignal` satisfies it. @public */
export type ArtworkAcquireSignal = {
  /** True once the acquisition should stop. */
  readonly aborted: boolean;
};

/** Options for one acquisition. @public */
export type ArtworkAcquireOptions = {
  /** Cancellation, sampled before and after every host await; an aborted acquisition returns no value. */
  readonly signal?: ArtworkAcquireSignal;
};

/** A version-aware pack loader that verifies exact artwork font bytes before returning them. @public */
export interface ArtworkShapePackLoader {
  /** Namespace, exact version and original index hash. */
  readonly identity: string;
  /** Validated, deeply frozen 1.0 or 1.1 metadata; never geometry or font bytes. */
  readonly index: VersionedShapePackIndex;
  /** Metadata search; performs no category or font I/O. */
  search(query: string): readonly ShapePackDefinitionEntry[];
  /** Acquire one definition and its verified fonts atomically: all of it, or diagnostics and nothing. */
  acquire(id: string, options?: ArtworkAcquireOptions): Promise<Result<AcquiredArtworkDefinition, readonly Diagnostic[]>>;
}

const cancelled = (id: string): Failure => problem(['definitions', id], 'acquisition was cancelled');
type Cached<T> = Map<string, Promise<Result<T, Failure>>>;

/** Share one in-flight or verified result per key; failures are evicted so a later call retries. */
function shared<T>(cache: Cached<T>, key: string, run: () => Promise<Result<T, Failure>>): Promise<Result<T, Failure>> {
  const cached = cache.get(key);
  if (cached) return cached;
  const pending = Promise.resolve().then(run);
  cache.set(key, pending);
  void pending.then((result) => {
    if (!result.ok && cache.get(key) === pending) cache.delete(key);
  });
  return pending;
}

/** Read within the declared size and verify the exact hash of the resource and its profile, which fixes size and WOFF2 format. */
async function readFont(resource: ShapePackDistributionFontResource, options: ShapePackLoaderOptions): Promise<Result<Uint8Array, Failure>> {
  const path = ['fontResources', resource.id];
  const profile = artworkFontProfiles[resource.profile];
  if (resource.size > ARTWORK_ACQUISITION_LIMITS.maxFontBytes) return err(problem(path, 'font resource exceeds the per-font byte limit'));
  try {
    const bytes = snapshot(await options.read(resource.path, resource.size), resource.size);
    if (!bytes) return err(problem(path, 'font bytes are missing or exceed the declared size'));
    const hash = await digest(bytes, options.hasher);
    if (hash !== resource.sha256 || hash !== profile.sha256) return err(problem(path, 'font SHA-256 does not match its resource and profile'));
    return ok(bytes);
  } catch {
    return err(problem(path, 'font resource could not be read or hashed'));
  }
}

type Binding = { readonly faceId: string; readonly family: string; readonly resource: ShapePackDistributionFontResource };
function bindingsOf(index: ShapePackIndex11, id: string): Result<readonly Binding[], Failure> {
  const faces = new Map(index.fontFaces.map((face) => [face.id, face]));
  const resources = new Map(index.fontResources.map((resource) => [resource.id, resource]));
  const faceIds = index.definitionFonts.find((binding) => binding.definitionId === id)?.faceIds ?? [];
  const bound = faceIds.flatMap((faceId) => {
    const face = faces.get(faceId);
    const resource = face && resources.get(face.resource);
    return face && resource ? [{ faceId, family: face.family, resource }] : [];
  });
  if (bound.length > ARTWORK_ACQUISITION_LIMITS.maxFaces) return err(problem(['definitions', id], 'definition binds more faces than one acquisition allows'));
  const total = bound.reduce((sum, b) => sum + b.resource.size, 0);
  if (total > ARTWORK_ACQUISITION_LIMITS.maxTotalFontBytes) return err(problem(['definitions', id], 'definition fonts exceed the acquisition byte limit'));
  return ok(bound);
}

type Signal = ArtworkAcquireSignal | undefined;
type State = {
  readonly index: VersionedShapePackIndex;
  readonly options: ShapePackLoaderOptions;
  readonly categories: Cached<ReadonlyMap<string, ShapeDef>>;
  readonly fonts: Cached<Uint8Array>;
};

/** Verified fonts in binding order, each an owned copy; any failure or cancellation returns nothing. */
async function acquireFonts(state: State, id: string, bound: readonly Binding[], signal: Signal): Promise<Result<AcquiredArtworkFont[], Failure>> {
  const acquired: AcquiredArtworkFont[] = [];
  for (const b of bound) {
    const bytes = await shared(state.fonts, b.resource.id, () => readFont(b.resource, state.options));
    if (signal?.aborted) return err(cancelled(id));
    if (!bytes.ok) return bytes;
    const { id: resourceId, sha256, profile } = b.resource;
    acquired.push(
      Object.freeze({ faceId: b.faceId, family: b.family, weight: 400, style: 'normal', resourceId, sha256, profile, bytes: new Uint8Array(bytes.value) }),
    );
  }
  return ok(acquired);
}

async function acquire(state: State, entry: ShapePackDefinitionEntry, signal: Signal): Promise<Result<AcquiredArtworkDefinition, Failure>> {
  const { index, options } = state;
  const id = entry.id;
  const bound = index.formatVersion === '1.1' ? bindingsOf(index, id) : ok([]);
  if (!bound.ok) return bound;
  if (signal?.aborted) return err(cancelled(id));
  const loaded = await shared(state.categories, entry.category, () => readCategory(index, entry.category, options, parseVersionedShapePackCategory));
  if (signal?.aborted) return err(cancelled(id));
  if (!loaded.ok) return loaded;
  const definition = loaded.value.get(id);
  if (!definition) return err(problem(['definitions', id], 'verified category lacks its indexed definition'));
  const fonts = await acquireFonts(state, id, bound.value, signal);
  if (!fonts.ok) return fonts;
  const credits = index.formatVersion === '1.1' ? index.fontCredits.filter((credit) => credit.definitionIds.includes(id)) : [];
  return ok(Object.freeze({ definition, fonts: Object.freeze(fonts.value), fontCredits: Object.freeze(credits) }));
}

function artworkLoader(index: VersionedShapePackIndex, hash: string, options: ShapePackLoaderOptions): ArtworkShapePackLoader {
  const entries = new Map<string, ShapePackDefinitionEntry>(index.definitions.map((entry) => [entry.id, entry]));
  const state: State = { index, options, categories: new Map(), fonts: new Map() };
  return Object.freeze({
    identity: `${index.id}@${index.version}#${hash}`,
    index,
    search: (query: string) => searchDefinitions(index.definitions, query),
    acquire: async (id: string, opts?: ArtworkAcquireOptions) => {
      // Snapshot the arguments before any await so later caller mutation cannot redirect this acquisition.
      const entry = entries.get(String(id));
      const signal = opts?.signal;
      return entry ? acquire(state, entry, signal) : err(problem(['definitions', String(id)], 'definition is not indexed'));
    },
  });
}

/**
 * Validate and snapshot a 1.0 or 1.1 index without reading geometry or fonts. Ordinary failures are diagnostics.
 * Use `createShapePackLoader` for 1.0 geometry only; it refuses 1.1 rather than drop font obligations.
 * @public
 */
export async function createArtworkShapePackLoader(
  indexBytes: Uint8Array,
  options: ShapePackLoaderOptions,
): Promise<Result<ArtworkShapePackLoader, readonly Diagnostic[]>> {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0) return err(problem([], 'byte limit must be a positive safe integer'));
  const bytes = snapshot(indexBytes, options.maxBytes);
  if (!bytes) return err(problem([], 'index exceeds the byte limit or is not bytes'));
  try {
    const ports = capabilities(options);
    const parsed = parseVersionedShapePackIndex(decode(bytes), ports.licensePolicy);
    if (!parsed.ok) return parsed;
    const hash = await digest(bytes, ports.hasher);
    return ok(artworkLoader(freezeJson(parsed.value), hash, ports));
  } catch {
    return err(problem([], 'index could not be hashed or decoded as UTF-8 JSON'));
  }
}
