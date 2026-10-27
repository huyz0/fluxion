import { allowsShapePackContentLicense, type VersionedShapePackSubset } from '@fluxion/core';
import type { PrepareShapePacksOptions, ShapePackSourceData } from '@fluxion/format';
import { basicPack } from '@fluxion/pack-basic';
import type { DocumentFile } from '@fluxion/schema';

/** Explicit bundled geometry; namespace strings never imply a builtin. */
const builtinIds: ReadonlySet<string> = new Set(basicPack.shapes.map((def) => def.id));

/** Capture unresolved references at open time, not from subsequent edited registry state. */
export function unresolvedShapeIds(document: DocumentFile, packs: readonly VersionedShapePackSubset[]): ReadonlySet<string> {
  const resolved = new Set([...builtinIds, ...packs.flatMap((pack) => pack.definitions.map((def) => def.id))]);
  const missing = new Set<string>();
  for (const record of Object.values(document.records)) {
    if (record.type === 'element' && record['kind'] === 'shape' && typeof record['defId'] === 'string' && !resolved.has(record['defId']))
      missing.add(record['defId']);
  }
  return missing;
}

/** Preserve loaded sources and require explicit provenance for newly supplied geometry. */
export function shapeSaveOptions(
  packs: readonly VersionedShapePackSubset[],
  sources: readonly ShapePackSourceData[],
  preserved: ReadonlySet<string>,
): Omit<PrepareShapePacksOptions, 'hasher'> & { readonly sources: readonly ShapePackSourceData[] } {
  return {
    sources: [...packs.map((subset) => ({ kind: 'embedded' as const, subset })), ...sources],
    builtinIds,
    licensePolicy: allowsShapePackContentLicense,
    preservedUnresolvedIds: preserved,
  };
}
