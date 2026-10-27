// Check a declarative pack's files through the same loader a host uses (ADR-0048, ADR-0050, ADR-0193).
import { allowsShapePackContentLicense, type ShapeDef, type ShapePackIndex, type ShapePackLicensePolicy, sha256Hex } from '@fluxion/core';
import { type Diagnostic, err, jsonPointer, ok, type Result } from '@fluxion/schema';
import { createShapePackLoader } from '../pack-loader.js';

/**
 * A checked pack: its validated index and every definition, loaded through the lazy loader in index order.
 *
 * @public
 */
export type CheckedShapePack = {
  /** Validated metadata. */
  readonly index: ShapePackIndex;
  /** Every indexed definition, verified against its category hash. */
  readonly definitions: readonly ShapeDef[];
};

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const problem = (path: readonly string[], message: string): Diagnostic => ({ code: 'FLX_PACK_INVALID', severity: 'error', path: jsonPointer(path), message });

/**
 * Check a pack's files, by pack-relative path, as a host would load them: the index through
 * `createShapePackLoader` with the repository content-license policy (or `licensePolicy`), then every
 * definition through its hash-verified category. A file the index does not name, an empty pack or any
 * loader diagnostic fails the whole pack.
 *
 * @public
 */
export async function checkShapePackFiles(
  files: Readonly<Record<string, string>>,
  licensePolicy: ShapePackLicensePolicy = allowsShapePackContentLicense,
): Promise<Result<CheckedShapePack, readonly Diagnostic[]>> {
  const indexText = files['index.json'];
  if (indexText === undefined) return err([problem(['index.json'], 'the pack has no index.json')]);
  const loaded = await createShapePackLoader(encode(indexText), {
    maxBytes: Number.MAX_SAFE_INTEGER,
    read: async (path) => {
      const text = Object.hasOwn(files, path) ? files[path] : undefined;
      if (text === undefined) throw new Error(`missing ${path}`);
      return encode(text);
    },
    hasher: { sha256: async (bytes) => sha256Hex(bytes) },
    licensePolicy,
  });
  if (!loaded.ok) return loaded;
  const { index } = loaded.value;
  const named = new Set(['index.json', ...Object.values(index.categories).map((c) => c.path)]);
  const stray = Object.keys(files).filter((path) => !named.has(path));
  if (stray.length) return err(stray.map((path) => problem([path], 'file is not named by the index')));
  if (index.definitions.length === 0) return err([problem(['definitions'], 'the pack has no definitions')]);
  const definitions: ShapeDef[] = [];
  const errors: Diagnostic[] = [];
  for (const entry of index.definitions) {
    const def = await loaded.value.load(entry.id);
    if (def.ok) definitions.push(def.value);
    else errors.push(...def.error);
  }
  return errors.length ? err(errors) : ok({ index, definitions });
}
