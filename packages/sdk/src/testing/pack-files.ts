// Check a declarative pack's files through the same loader a host uses (ADR-0048, ADR-0050, ADR-0193): the version-aware artwork
// loader, so a 1.1 pack's exact fonts are read and verified as a host acquires them (ADR-0192). A `connectors.json` beside the
// index is read as a host reads it, with `loadPackConnectors` (M18.250).
import {
  allowsShapePackContentLicense,
  type ConnectorDef,
  packHasFonts,
  type ShapeDef,
  type ShapePackLicensePolicy,
  sha256Hex,
  type VersionedShapePackIndex,
} from '@fluxion/core';
import { type Diagnostic, err, jsonPointer, ok, type Result } from '@fluxion/schema';
import { createArtworkShapePackLoader } from '../artwork-pack-loader.js';
import { loadPackConnectors } from '../pack-connectors.js';

/**
 * A checked pack: its validated index and every definition, loaded through the lazy loader in index order.
 *
 * @public
 */
export type CheckedShapePack = {
  /** Validated 1.0 or 1.1 metadata. */
  readonly index: VersionedShapePackIndex;
  /** Every indexed definition, verified against its category hash (and, for 1.1, with its exact fonts acquired). */
  readonly definitions: readonly ShapeDef[];
  /** The connector types of its `connectors.json`, when it has one (M18.250). */
  readonly connectors?: readonly ConnectorDef[];
};

/** The connectors file beside the index, which the index does not name (ADR-0048). */
const CONNECTORS = 'connectors.json';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const problem = (path: readonly string[], message: string): Diagnostic => ({ code: 'FLX_PACK_INVALID', severity: 'error', path: jsonPointer(path), message });

/** The bytes of `path`: text files encoded, font files as given; a path in neither map throws, as a missing file would. */
function reader(files: Readonly<Record<string, string>>, fonts: Readonly<Record<string, Uint8Array>>) {
  return async (path: string): Promise<Uint8Array> => {
    const text = Object.hasOwn(files, path) ? files[path] : undefined;
    if (text !== undefined) return encode(text);
    const bytes = Object.hasOwn(fonts, path) ? fonts[path] : undefined;
    if (bytes === undefined) throw new Error(`missing ${path}`);
    return bytes.slice();
  };
}

/** Every path the index names: itself, its categories and, for 1.1 and 1.2, its font resources; and the connectors file. */
function namedPaths(index: VersionedShapePackIndex): Set<string> {
  const fonts = packHasFonts(index) ? index.fontResources.map((r) => r.path) : [];
  return new Set(['index.json', ...Object.values(index.categories).map((c) => c.path), ...fonts, CONNECTORS]);
}

/** The connector types of `files`' connectors file for pack `pack` (none without one), or its diagnostics under its path. */
function connectorsOf(files: Readonly<Record<string, string>>, pack: string): Result<readonly ConnectorDef[] | undefined, readonly Diagnostic[]> {
  const text = Object.hasOwn(files, CONNECTORS) ? files[CONNECTORS] : undefined;
  if (text === undefined) return ok(undefined);
  const loaded = loadPackConnectors(encode(text), pack, Number.MAX_SAFE_INTEGER);
  return loaded.ok ? loaded : err(loaded.error.map((d) => ({ ...d, path: `${jsonPointer([CONNECTORS])}${d.path}` })));
}

/**
 * Check a pack's files, by pack-relative path, as a host would load them: the index through
 * `createArtworkShapePackLoader` with the repository content-license policy (or `licensePolicy`), then every
 * definition through its hash-verified category and, for a 1.1 pack, its exact fonts from `fonts` (binary files by
 * pack-relative path, `fonts/<sha256>.woff2`), each verified against its resource, and a `connectors.json` through
 * `loadPackConnectors`. Another file the index does not name, an empty pack or any loader diagnostic fails the whole pack.
 *
 * @public
 */
export async function checkShapePackFiles(
  files: Readonly<Record<string, string>>,
  licensePolicy: ShapePackLicensePolicy = allowsShapePackContentLicense,
  fonts: Readonly<Record<string, Uint8Array>> = {},
): Promise<Result<CheckedShapePack, readonly Diagnostic[]>> {
  const indexText = files['index.json'];
  if (indexText === undefined) return err([problem(['index.json'], 'the pack has no index.json')]);
  const loaded = await createArtworkShapePackLoader(encode(indexText), {
    maxBytes: Number.MAX_SAFE_INTEGER,
    read: reader(files, fonts),
    hasher: { sha256: async (bytes) => sha256Hex(bytes) },
    licensePolicy,
  });
  if (!loaded.ok) return loaded;
  const { index } = loaded.value;
  const named = namedPaths(index);
  const stray = [...Object.keys(files), ...Object.keys(fonts)].filter((path) => !named.has(path));
  if (stray.length) return err(stray.map((path) => problem([path], 'file is not named by the index')));
  if (index.definitions.length === 0) return err([problem(['definitions'], 'the pack has no definitions')]);
  const connectors = connectorsOf(files, index.id);
  if (!connectors.ok) return connectors;
  const definitions: ShapeDef[] = [];
  const errors: Diagnostic[] = [];
  for (const entry of index.definitions) {
    const acquired = await loaded.value.acquire(entry.id);
    if (acquired.ok) definitions.push(acquired.value.definition);
    else errors.push(...acquired.error);
  }
  return errors.length ? err(errors) : ok({ index, definitions, ...(connectors.value === undefined ? {} : { connectors: connectors.value }) });
}
