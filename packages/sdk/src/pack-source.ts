// Declarative pack source (ADR-0048, ADR-0050, ADR-0194): the metadata and definitions a pack package exports, and the canonical
// distribution files built from them by core's shared encoder (M18.108, ADR-0196).
import { allowsShapePackContentLicense, encodeShapePack, type ShapeDef, type ShapePackDraft, type ShapePackLicensePolicy } from '@fluxion/core';
import { type Diagnostic, ok, type Result } from '@fluxion/schema';

/**
 * A declarative pack as authored and exported by its package (ADR-0194): its index metadata, source
 * credits and definitions with display names. Every definition carries its `category`; categories are
 * written in order of first use. A first-party pack's `version` is its package version. The same shape
 * as core's `ShapePackDraft`, which every pack encoder takes (ADR-0196).
 *
 * @public
 */
export type DeclarativeShapePack = ShapePackDraft;

/**
 * The canonical distribution text files of `pack`, by pack-relative path: `index.json` and one
 * `categories/<slug>.json` per category, encoded and validated by core's shared `encodeShapePack`
 * (ADR-0196) under the repository content-license policy (or `licensePolicy`): sorted-key two-space JSON
 * ending in a newline, with each category's SHA-256 in the index. The same pack always gives the same
 * bytes; an invalid pack gives its diagnostics and no files. A 1.1 pack's binary `fonts/<sha256>.woff2` files are
 * its draft's exact `fonts.bytes` (ADR-0192), verified by the encoder and left out of this text map.
 *
 * @public
 */
export function buildShapePackFiles(
  pack: DeclarativeShapePack,
  licensePolicy: ShapePackLicensePolicy = allowsShapePackContentLicense,
): Result<Readonly<Record<string, string>>, readonly Diagnostic[]> {
  const encoded = encodeShapePack(pack, licensePolicy);
  if (!encoded.ok) return encoded;
  const decoder = new TextDecoder();
  const text = [...encoded.value.files].filter(([path]) => !path.startsWith('fonts/'));
  return ok(Object.fromEntries(text.map(([path, bytes]) => [path, decoder.decode(bytes)])));
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
