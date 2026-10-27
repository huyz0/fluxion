import type { QualifiedName } from '@fluxion/schema';
import type { ShapePackCategory, ShapePackIndex, ShapePackSource, ShapePackSubset } from './pack-types.js';
import type { ShapeDef } from './shape-def.js';

/** Exact font bytes a pack 1.1 envelope declares; no bytes are carried in metadata. @public */
export type ShapePackFontResource = {
  /** Unique pack-local resource identifier. */
  readonly id: string;
  /** Lowercase SHA-256 of the exact bytes. */
  readonly sha256: string;
  /** Exact byte length. */
  readonly size: number;
  /** Media type; only WOFF2 is supported. */
  readonly mime: 'font/woff2';
  /** Supported profile name from `artworkFontProfiles`. */
  readonly profile: 'inter-latin-400-ascii';
};

/** A distribution resource with its canonical `fonts/<sha256>.woff2` path. @public */
export type ShapePackDistributionFontResource = ShapePackFontResource & {
  /** Exactly `fonts/<sha256>.woff2`, relative to the pack root. */
  readonly path: string;
};

/** One source face descriptor bound to exact resource bytes. @public */
export type ShapePackFontFace = {
  /** Unique pack-local face identifier. */
  readonly id: string;
  /** Original source family, kept verbatim; never resolved through theme fonts. */
  readonly family: string;
  /** Static weight, fixed by the resource profile. */
  readonly weight: 400;
  /** Static style, fixed by the resource profile. */
  readonly style: 'normal';
  /** The resource holding this face's bytes. */
  readonly resource: string;
};

/** The exact text-face closure of one definition. @public */
export type ShapePackDefinitionFonts = {
  /** Bound definition. */
  readonly definitionId: QualifiedName;
  /** Faces its artwork text uses, exactly and without duplicates. */
  readonly faceIds: readonly string[];
};

/** Rights for font resources, scoped to explicit resources and definitions. @public */
export type ShapePackFontCredit = {
  /** Unique identifier among font credits. */
  readonly id: string;
  /** SPDX identifier from `artworkFontLicenses`, also checked by the caller's policy. */
  readonly license: string;
  /** Human-readable attribution, preserved verbatim. */
  readonly attribution: string;
  /** Complete notice text. */
  readonly notice: string;
  /** Inert source declaration; never fetched. */
  readonly source: ShapePackSource;
  /** Covered resources. */
  readonly resourceIds: readonly string[];
  /** Covered definitions; each must use a covered resource. */
  readonly definitionIds: readonly QualifiedName[];
};

/** Font metadata shared by pack 1.1 envelopes. @public */
export type ShapePackFonts<R extends ShapePackFontResource> = {
  /** Exact byte resources. */
  readonly fontResources: readonly R[];
  /** Source face descriptors. */
  readonly fontFaces: readonly ShapePackFontFace[];
  /** Per-definition face closures. */
  readonly definitionFonts: readonly ShapePackDefinitionFonts[];
  /** Scoped font rights. */
  readonly fontCredits: readonly ShapePackFontCredit[];
};

/** Version 1.1 distribution metadata with exact font bindings (ADR-0192). @public */
export type ShapePackIndex11 = Omit<ShapePackIndex, 'formatVersion'> & {
  /** Distribution format version. */
  readonly formatVersion: '1.1';
} & ShapePackFonts<ShapePackDistributionFontResource>;

/** Version 1.1 category geometry, validated against its index's font closure. @public */
export type ShapePackCategory11 = {
  /** Distribution format version. */
  readonly formatVersion: '1.1';
  /** Exactly the indexed definitions assigned to this category. */
  readonly definitions: readonly ShapeDef[];
};

/** Version 1.1 saved subset; every included definition's font closure is retained. @public */
export type ShapePackSubset11 = Omit<ShapePackSubset, 'formatVersion'> & {
  /** Saved pack format. */
  readonly formatVersion: '1.1';
} & ShapePackFonts<ShapePackFontResource>;

/** A pack index of any supported version. @public */
export type VersionedShapePackIndex = ShapePackIndex | ShapePackIndex11;
/** A category of any supported version. @public */
export type VersionedShapePackCategory = ShapePackCategory | ShapePackCategory11;
/** A saved subset of any supported version. @public */
export type VersionedShapePackSubset = ShapePackSubset | ShapePackSubset11;
