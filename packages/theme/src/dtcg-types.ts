// The warning and result types of theme-file import and export (ADR-0055), in their own module so the readers share them without
// importing each other.

import type { Theme } from './tokens.js';

/**
 * What a theme-file warning reports (ADR-0055): `DTCG_UNSUPPORTED` (something the format or the theme model cannot carry, left out
 * or converted), `DTCG_PATH_RENAMED` (a foreign path moved so the theme's own keeps its shape), `DTCG_TYPE_MISMATCH` (a token of
 * another type than its path takes, left out), `DTCG_ALIAS_BROKEN` (a link to nothing, to a dropped token, or in a loop, left out),
 * `DTCG_ROLE_MAPPED` (a required role aliased to a foreign name) and `DTCG_ROLE_DEFAULTED` (a role kept from the base theme).
 *
 * @public
 */
export type DtcgWarningCode =
  | 'DTCG_UNSUPPORTED'
  | 'DTCG_PATH_RENAMED'
  | 'DTCG_TYPE_MISMATCH'
  | 'DTCG_ALIAS_BROKEN'
  | 'DTCG_ROLE_MAPPED'
  | 'DTCG_ROLE_DEFAULTED';

/**
 * A warning of a theme-file export or import: what was left out, renamed or mapped, and where.
 *
 * @public
 */
export type DtcgWarning = {
  /** What happened. */
  readonly code: DtcgWarningCode;
  /** The token or group path (`color.primary`; `(root)` for the file's root). */
  readonly path: string;
  /** One-line message. */
  readonly message: string;
};

/**
 * A theme read from a theme file, and what was left out.
 *
 * @public
 */
export type ImportedTheme = {
  /** The theme. */
  readonly theme: Theme;
  /** What could not be read (empty for a file `exportDtcg` wrote). */
  readonly warnings: readonly DtcgWarning[];
};
