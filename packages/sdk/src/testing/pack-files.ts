// First-party declarative pack files (ADR-0048, ADR-0050, ADR-0193): build the canonical distribution
// text from definitions, and check checked-in files through the same loader a host uses.
import { allowsShapePackContentLicense, type ShapeDef, type ShapePackCredit, type ShapePackIndex, type ShapePackLicensePolicy, sha256Hex } from '@fluxion/core';
import { type Diagnostic, err, jsonPointer, ok, type Result } from '@fluxion/schema';
import { createShapePackLoader } from '../pack-loader.js';

/**
 * A declarative pack as authored: its index metadata and its definitions with display names. Every
 * definition carries its `category`; categories are written in order of first use.
 *
 * @public
 */
export type ShapePackDraft = {
  /** Pack namespace. */
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
  readonly definitions: readonly { readonly name: string; readonly def: ShapeDef }[];
};

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

const canonical = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const problem = (path: readonly string[], message: string): Diagnostic => ({ code: 'FLX_PACK_INVALID', severity: 'error', path: jsonPointer(path), message });

/**
 * The canonical distribution files of `draft`, by pack-relative path: `index.json` and one
 * `categories/<slug>.json` per category, each two-space JSON ending in a newline, with each category's
 * SHA-256 in the index. The same draft always gives the same bytes. Nothing is validated here: check the
 * result with {@link checkShapePackFiles}.
 *
 * @public
 */
export function buildShapePackFiles(draft: ShapePackDraft): Readonly<Record<string, string>> {
  const byCategory = new Map<string, ShapeDef[]>();
  for (const { def } of draft.definitions) {
    const slug = def.category ?? '';
    byCategory.set(slug, [...(byCategory.get(slug) ?? []), def]);
  }
  const files: Record<string, string> = {};
  const categories: Record<string, { path: string; sha256: string }> = {};
  for (const [slug, definitions] of byCategory) {
    const path = `categories/${slug}.json`;
    const text = canonical({ formatVersion: '1.0', definitions });
    files[path] = text;
    categories[slug] = { path, sha256: sha256Hex(encode(text)) };
  }
  const index = {
    format: 'fluxion-shape-pack',
    formatVersion: '1.0',
    id: draft.id,
    version: draft.version,
    name: draft.name,
    license: draft.license,
    attribution: draft.attribution,
    categories,
    definitions: draft.definitions.map(({ name, def }) => ({ id: def.id, name, keywords: def.keywords ?? [], category: def.category ?? '' })),
    credits: draft.credits,
  };
  return { 'index.json': canonical(index), ...files };
}

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
