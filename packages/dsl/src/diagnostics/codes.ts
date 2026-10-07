// The FluxScript diagnostic codes (ADR-0030). Codes are stable public API: add, never rename. The docs page is generated from this table.
import type { DiagnosticSeverity } from '@fluxion/schema';

/**
 * One FluxScript code: its default severity and a one-line description.
 *
 * @public
 */
export type DslCodeEntry = {
  /** Default severity. */
  readonly severity: DiagnosticSeverity;
  /** When the compiler reports it. */
  readonly description: string;
};

/**
 * A FluxScript diagnostic code.
 *
 * @public
 */
export type DslCode =
  | 'FLX_DSL_SYNTAX'
  | 'FLX_DSL_VERSION'
  | 'FLX_DSL_UNKNOWN_KEY'
  | 'FLX_DSL_EDGE_SYNTAX'
  | 'FLX_DSL_BAD_SLUG'
  | 'FLX_DSL_DUP_SLUG'
  | 'FLX_DSL_UNKNOWN_SHAPE'
  | 'FLX_DSL_AMBIGUOUS_SHAPE'
  | 'FLX_DSL_UNKNOWN_PACK'
  | 'FLX_DSL_NOT_YET';

/**
 * The FluxScript diagnostic codes of `flux: 1`.
 *
 * @public
 */
export const DSL_CODES: { readonly [C in DslCode]: DslCodeEntry } = {
  FLX_DSL_SYNTAX: { severity: 'error', description: 'YAML that does not parse, or uses anchors, aliases, tags or duplicate keys.' },
  FLX_DSL_VERSION: { severity: 'error', description: '`flux` is missing, or is not 1.' },
  FLX_DSL_UNKNOWN_KEY: { severity: 'error', description: 'A key the v1 grammar does not have at that position.' },
  FLX_DSL_EDGE_SYNTAX: { severity: 'error', description: 'An edge that is not `<end> <op> <end>` with one of the five ops.' },
  FLX_DSL_BAD_SLUG: { severity: 'error', description: 'A slug or screen id that is not lower-case `[a-z][a-z0-9-]*`.' },
  FLX_DSL_DUP_SLUG: { severity: 'error', description: 'A node or group slug used twice in the document.' },
  FLX_DSL_UNKNOWN_SHAPE: { severity: 'error', description: 'A shape not found through the packs in `uses:`.' },
  FLX_DSL_AMBIGUOUS_SHAPE: { severity: 'error', description: 'A short shape name that more than one used pack defines.' },
  FLX_DSL_UNKNOWN_PACK: { severity: 'warning', description: 'A pack in `uses:` that is not registered; its shapes are then unknown.' },
  FLX_DSL_NOT_YET: { severity: 'warning', description: 'A v1 section this compiler keeps in `document.source` but does not compile yet.' },
};
