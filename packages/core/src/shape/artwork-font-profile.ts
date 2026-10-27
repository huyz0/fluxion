/** Exact identity of one supported artwork font profile (ADR-0189, ADR-0192). @public */
export type ArtworkFontProfile = {
  /** Lowercase SHA-256 of the only accepted bytes. */
  readonly sha256: string;
  /** Exact byte length of those bytes. */
  readonly size: number;
  /** Media type of the bytes. */
  readonly mime: 'font/woff2';
  /** Static weight every face of this profile declares. */
  readonly weight: 400;
  /** Static style every face of this profile declares. */
  readonly style: 'normal';
};

/**
 * Supported artwork font profiles keyed by profile name. Only pinned Inter 400 normal ASCII is
 * accepted; this is not arbitrary-font, variable-font or subsetting support.
 * @public
 */
export const artworkFontProfiles: Readonly<Record<'inter-latin-400-ascii', ArtworkFontProfile>> = Object.freeze({
  'inter-latin-400-ascii': Object.freeze({
    sha256: '8909904ab6c872eb994093482a88a28eca2cd95912d7b6fecd72103b0dc07edc',
    size: 23664,
    mime: 'font/woff2',
    weight: 400,
    style: 'normal',
  }),
});

/**
 * SPDX identifiers accepted for artwork font rights, independent of the shape license policy.
 * @public
 */
export const artworkFontLicenses: readonly string[] = Object.freeze(['OFL-1.1', 'Apache-2.0']);
