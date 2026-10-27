// Declarative pack source (ADR-0048, ADR-0050, ADR-0194): the metadata and definitions a pack package exports, and the canonical
// distribution files built from them. Pure: hashing is core's synchronous SHA-256.
import { type ShapeDef, type ShapePackCredit, sha256Hex } from '@fluxion/core';

const canonical = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

/**
 * A declarative pack as authored and exported by its package (ADR-0194): its index metadata, source
 * credits and definitions with display names. Every definition carries its `category`; categories are
 * written in order of first use. A first-party pack's `version` is its package version.
 *
 * @public
 */
export type DeclarativeShapePack = {
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
  readonly definitions: readonly {
    /** Library display name. */
    readonly name: string;
    /** The definition. */
    readonly def: ShapeDef;
  }[];
};

/**
 * The canonical distribution files of `pack`, by pack-relative path: `index.json` and one
 * `categories/<slug>.json` per category, each two-space JSON ending in a newline, with each category's
 * SHA-256 in the index. The same pack always gives the same bytes. Nothing is validated here: check the
 * result with `checkShapePackFiles` from `@fluxion/sdk/testing`.
 *
 * @public
 */
export function buildShapePackFiles(pack: DeclarativeShapePack): Readonly<Record<string, string>> {
  const byCategory = new Map<string, ShapeDef[]>();
  for (const { def } of pack.definitions) {
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
    id: pack.id,
    version: pack.version,
    name: pack.name,
    license: pack.license,
    attribution: pack.attribution,
    categories,
    definitions: pack.definitions.map(({ name, def }) => ({ id: def.id, name, keywords: def.keywords ?? [], category: def.category ?? '' })),
    credits: pack.credits,
  };
  return { 'index.json': canonical(index), ...files };
}

/**
 * `defs` in order, each with its display name from `names` (by definition id). A definition without a
 * name gets an empty one, which the pack schema rejects, so a forgotten name fails the pack's check.
 *
 * @public
 */
export function namedShapeDefs(defs: readonly ShapeDef[], names: Readonly<Record<string, string>>): DeclarativeShapePack['definitions'] {
  return defs.map((def) => ({ name: names[def.id] ?? '', def }));
}
