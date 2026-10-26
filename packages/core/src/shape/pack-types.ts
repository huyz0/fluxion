import type { QualifiedName } from '@fluxion/schema';
import type { ShapeDef } from './shape-def.js';

/** Explicit source declarations retained with a declarative shape pack. @public */
export type ShapePackSource =
  | {
      /** Original authorship declaration. */
      readonly kind: 'original';
      /** Declared author; validation does not establish ownership. */
      readonly author: string;
      /** Explicit original-work/rights statement. */
      readonly statement: string;
    }
  | {
      /** Source bytes obtained upstream. */
      readonly kind: 'upstream';
      /** Inert source reference; never fetched by the parser. */
      readonly reference: string;
      /** SHA-256 of the original source bytes. */
      readonly sha256: string;
      /** Upstream revision when available. */
      readonly revision?: string;
      /** Description of modifications, if any. */
      readonly modifications?: string;
    };

/** A source's preserved rights and attribution, globally or for selected definitions. @public */
export type ShapePackCredit = {
  /** Unique pack-local credit identifier. */
  readonly id: string;
  /** Original SPDX expression checked by the caller's content policy. */
  readonly license: string;
  /** Human-readable attribution, preserved verbatim. */
  readonly attribution: string;
  /** Complete notice text supplied by the source. */
  readonly notice: string;
  /** Explicit source declaration. */
  readonly source: ShapePackSource;
  /** Indexed IDs covered by this credit; absent means every definition. */
  readonly definitionIds?: readonly QualifiedName[];
};

/** Metadata for one lazily loaded category. @public */
export type ShapePackCategoryEntry = {
  /** Exactly `categories/<slug>.json`, relative to the pack root. */
  readonly path: string;
  /** SHA-256 of the category's original bytes, verified by the loader. */
  readonly sha256: string;
};

/** Search metadata that contains no geometry. @public */
export type ShapePackDefinitionEntry = {
  /** Qualified ID in the pack namespace. */
  readonly id: QualifiedName;
  /** Display label, authoritative independently of geometry. */
  readonly name: string;
  /** Search terms, without loading a category. */
  readonly keywords: readonly string[];
  /** Indexed category slug. */
  readonly category: string;
};

/** Version 1.0 declarative pack metadata; semantic validation requires parseShapePackIndex. @public */
export type ShapePackIndex = {
  /** Envelope discriminator. */
  readonly format: 'fluxion-shape-pack';
  /** Distribution format version, separate from document schemaVersion. */
  readonly formatVersion: '1.0';
  /** Pack namespace. */
  readonly id: string;
  /** Exact semantic version. */
  readonly version: string;
  /** Display name. */
  readonly name: string;
  /** Default pack SPDX expression. */
  readonly license: string;
  /** Pack attribution, retained alongside source credits. */
  readonly attribution: string;
  /** Category descriptors keyed by slug. */
  readonly categories: Readonly<Record<string, ShapePackCategoryEntry>>;
  /** Metadata-only definition index. */
  readonly definitions: readonly ShapePackDefinitionEntry[];
  /** Credits covering every definition. */
  readonly credits: readonly ShapePackCredit[];
};

/** A complete category's geometry; validation never returns a partial category. @public */
export type ShapePackCategory = {
  /** Distribution format version. */
  readonly formatVersion: '1.0';
  /** Exactly the indexed definitions assigned to this category. */
  readonly definitions: readonly ShapeDef[];
};

/** Validated used geometry and credits saved without a distribution index (ADR-0182). @public */
export type ShapePackSubset = {
  /** Data-only envelope discriminator. */
  readonly format: 'fluxion-shape-pack';
  /** Saved pack format, independent of document schemaVersion. */
  readonly formatVersion: '1.0';
  /** Namespace shared by every definition. */
  readonly id: string;
  /** Exact pack version. */
  readonly version: string;
  /** Default SPDX expression, checked by the explicit policy. */
  readonly license: string;
  /** Pack attribution retained with source credits. */
  readonly attribution: string;
  /** Nonempty used geometry; no category metadata is invented. */
  readonly definitions: readonly ShapeDef[];
  /** Complete applicable source credits. */
  readonly credits: readonly ShapePackCredit[];
};

/**
 * Pure host-supplied content license policy. Return true only for a permitted, recognized SPDX expression.
 * Distribution/import adapters must supply the repository content policy, including AND/OR obligations;
 * this callback is not an ownership check. There is no permissive default.
 * @public
 */
export type ShapePackLicensePolicy = (expression: string) => boolean;
