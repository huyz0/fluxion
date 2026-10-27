import {
  type Hasher,
  parseShapePackCategory,
  parseShapePackIndex,
  type ShapeDef,
  type ShapePackDefinitionEntry,
  type ShapePackIndex,
  type ShapePackLicensePolicy,
} from '@fluxion/core';
import { type Diagnostic, err, ok, type Result } from '@fluxion/schema';
import { decode, digest, freezeJson, problem, snapshot } from './pack-bytes.js';

type Failure = readonly Diagnostic[];
type Category = Result<ReadonlyMap<string, ShapeDef>, Failure>;

/** Explicit host capabilities for loading inert shape data. @public */
export type ShapePackLoaderOptions = {
  /** Maximum bytes per index/category; the reader must enforce it while reading too. */
  readonly maxBytes: number;
  /** Read only the indexed relative path, aborting when its byte cap is exceeded. */
  readonly read: (path: string, maxBytes: number) => Promise<Uint8Array>;
  /** Host-supplied SHA-256 implementation; no synchronous main-thread hash is imposed. */
  readonly hasher: Hasher;
  /** Explicit content-license policy; there is no permissive default. */
  readonly licensePolicy: ShapePackLicensePolicy;
};

/** A verified metadata index with lazily verified category geometry. @public */
export interface ShapePackLoader {
  /** Namespace, exact version and original index hash; cache scope is this loader instance. */
  readonly identity: string;
  /** Validated, deeply frozen metadata; never contains category geometry. */
  readonly index: ShapePackIndex;
  /** Case-insensitive, all-token substring search in stable index order; empty query returns all metadata. */
  search(query: string): readonly ShapePackDefinitionEntry[];
  /** Load an indexed definition; concurrent category requests share I/O, and failures are not cached permanently. */
  load(id: string): Promise<Result<ShapeDef, readonly Diagnostic[]>>;
}

/** A category parser: the 1.0 parser, or the version-aware one for artwork acquisition. @internal */
export type CategoryParser = (
  input: unknown,
  index: unknown,
  category: string,
  policy: ShapePackLicensePolicy,
) => Result<{ readonly definitions: readonly ShapeDef[] }, Failure>;

/** Read, bound, hash-check and parse one indexed category into frozen definitions by ID. @internal */
export async function readCategory(
  index: Pick<ShapePackIndex, 'categories'>,
  category: string,
  options: ShapePackLoaderOptions,
  parse: CategoryParser = parseShapePackCategory,
): Promise<Category> {
  const path = ['categories', category];
  const descriptor = index.categories[category];
  if (!descriptor) return err(problem(path, 'category is not indexed'));
  try {
    const bytes = snapshot(await options.read(descriptor.path, options.maxBytes), options.maxBytes);
    if (!bytes) return err(problem(path, 'category exceeds the byte limit or is not bytes'));
    if ((await digest(bytes, options.hasher)) !== descriptor.sha256) return err(problem(path, 'category SHA-256 does not match its index'));
    const parsed = parse(decode(bytes), index, category, options.licensePolicy);
    if (!parsed.ok) return parsed;
    return ok(new Map(freezeJson(parsed.value).definitions.map((definition) => [definition.id, definition])));
  } catch {
    return err(problem(path, 'category could not be read, hashed or decoded as UTF-8 JSON'));
  }
}

/** Case-insensitive, all-token substring search in stable order. @internal */
export function searchDefinitions(definitions: readonly ShapePackDefinitionEntry[], query: string): readonly ShapePackDefinitionEntry[] {
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return definitions.filter((entry) => {
    const text = `${entry.id} ${entry.name} ${entry.keywords.join(' ')}`.toLowerCase();
    return tokens.every((token) => text.includes(token));
  });
}

function lazyLoader(index: ShapePackIndex, hash: string, options: ShapePackLoaderOptions): ShapePackLoader {
  const entries = new Map<string, ShapePackDefinitionEntry>(index.definitions.map((entry) => [entry.id, entry]));
  const categories = new Map<string, Promise<Category>>();
  const category = (name: string): Promise<Category> => {
    const cached = categories.get(name);
    if (cached) return cached;
    // Publish the promise before invoking a host port, including a synchronous reentrant reader.
    const pending = Promise.resolve().then(() => readCategory(index, name, options));
    categories.set(name, pending);
    void pending.then((result) => {
      if (!result.ok && categories.get(name) === pending) categories.delete(name);
    });
    return pending;
  };
  return Object.freeze({
    identity: `${index.id}@${index.version}#${hash}`,
    index,
    search: (query: string) => searchDefinitions(index.definitions, query),
    load: async (id: string): Promise<Result<ShapeDef, Failure>> => {
      const entry = entries.get(id);
      if (!entry) return err(problem(['definitions', id], 'definition is not indexed'));
      const loaded = await category(entry.category);
      if (!loaded.ok) return loaded;
      const definition = loaded.value.get(id);
      return definition ? ok(definition) : err(problem(['definitions', id], 'verified category lacks its indexed definition'));
    },
  });
}

/** Capture host capabilities so later caller mutation cannot change policy or I/O. @internal */
export function capabilities(options: ShapePackLoaderOptions): ShapePackLoaderOptions {
  return {
    maxBytes: options.maxBytes,
    read: options.read.bind(options),
    licensePolicy: options.licensePolicy,
    hasher: { sha256: options.hasher.sha256.bind(options.hasher) },
  };
}

/** Validate and snapshot index bytes without reading geometry; ordinary failures are diagnostics. @public */
export async function createShapePackLoader(indexBytes: Uint8Array, options: ShapePackLoaderOptions): Promise<Result<ShapePackLoader, readonly Diagnostic[]>> {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0) return err(problem([], 'byte limit must be a positive safe integer'));
  const bytes = snapshot(indexBytes, options.maxBytes);
  if (!bytes) return err(problem([], 'index exceeds the byte limit or is not bytes'));
  try {
    const ports = capabilities(options);
    const parsed = parseShapePackIndex(decode(bytes), ports.licensePolicy);
    if (!parsed.ok) return parsed;
    const hash = await digest(bytes, ports.hasher);
    // Capture capabilities/configuration so caller property mutation cannot change cache identity or policy.
    return ok(lazyLoader(freezeJson(parsed.value), hash, ports));
  } catch {
    return err(problem([], 'index could not be hashed or decoded as UTF-8 JSON'));
  }
}
