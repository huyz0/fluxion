import type { ShapeDef } from '@fluxion/core';
import type { Diagnostic, SvgArtwork, TokenRef } from '@fluxion/schema';

/** A host-resolved static font face required by imported text; no inferred license. @public */
export type SvgImportFont = {
  /** Explicit CSS family. */
  readonly family: string;
  /** Static CSS weight. */
  readonly weight: number;
  /** Supported face style. */
  readonly style: 'normal' | 'italic';
  /** SHA256 of the exact font bytes the host loads and preserves. */
  readonly sha256: string;
};
/** Bounded isolated artwork paint request; no backgrounds, placeholders or host effects. @public */
export type SvgPaintRequest = {
  /** Canonical SHA256 of artwork, font faces and raster dimensions. */
  readonly identity: string;
  /** Core-validated source paint, including checked color mappings. */
  readonly artwork: SvgArtwork;
  /** Canonical raster width, at most 1024. */
  readonly width: number;
  /** Canonical raster height, at most 1024. */
  readonly height: number;
  /** Exact faces whose load/coverage the host must verify before witnessing paint. */
  readonly fonts: readonly SvgImportFont[];
};
/** Receipt from an explicit trusted host effect port; not a remote attestation. @public */
export type SvgPaintReceipt = {
  /** The request identity actually rendered. */
  readonly identity: string;
  /** Positive paint only; no-witness is not proof of mathematical emptiness. */
  readonly status: 'painted' | 'no-witness' | 'unsupported';
  /** Exact loaded/covered face hashes; missing requested faces refuse import. */
  readonly fontHashes: readonly string[];
};
/** Host port: one bounded isolated render, no network or retry-to-green; errors refuse import. @public */
export type SvgPaintWitness = (request: SvgPaintRequest) => Promise<SvgPaintReceipt>;
/** Capabilities and identity for a pure single-SVG conversion. @public */
export type SvgImportOptions = {
  /** Qualified definition ID; validated by core. */
  readonly id: string;
  /** Required real-renderer witness under the host's active theme/font context. */
  readonly witness: SvgPaintWitness;
  /** Optional literal colors to existing token references. */
  readonly colors?: Readonly<Record<string, TokenRef>>;
  /** Existing references in the same theme used by the witness. */
  readonly tokenRefs?: ReadonlySet<string>;
  /** Available exact static faces; hosts own loading, licensing and persistence. */
  readonly fonts?: readonly SvgImportFont[];
  /** Available face hash used only where SVG leaves the font unspecified. */
  readonly defaultFont?: string;
};
/** Validated definition and obligations for the importing host; not a distributable pack. @public */
export type SvgImportResult = {
  /** Preserved paint, routing outline and four anchors. */
  readonly definition: ShapeDef;
  /** Stable warnings such as conservative viewport routing fallback. */
  readonly diagnostics: readonly Diagnostic[];
  /** Required exact font faces, to retain through installation and portable save. */
  readonly fonts: readonly SvgImportFont[];
};
