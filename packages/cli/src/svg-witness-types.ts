import type { SvgPaintReceipt, SvgPaintRequest, SvgPaintWitness } from '@fluxion/format';
import type { SvgWitnessFont, SvgWitnessOptions } from '@fluxion/render/svg-witness';
import { type Diagnostic, type Err, err, type Result } from '@fluxion/schema';

/** Distinct host setup, observation and owned-process cleanup outcomes. @public */
export type NodeSvgWitnessFailureKind =
  | 'invalid-input'
  | 'unsupported'
  | 'peer-missing'
  | 'deadline'
  | 'cancelled'
  | 'cleanup'
  | 'transport'
  | 'busy'
  | 'disposed';
/** A failed Node host operation; cleanup failure is never positive paint evidence. @public */
export type NodeSvgWitnessFailure = {
  /** Machine-readable host failure category. */
  readonly kind: NodeSvgWitnessFailureKind;
  /** Existing Fluxion diagnostics for CLI and library consumers. */
  readonly diagnostics: readonly Diagnostic[];
};
/** Explicit context for the packaged, network-blocked browser witness. @public */
export type NodeSvgWitnessOptions = {
  /** Bounded active theme, independently copied before transport. */
  readonly theme: SvgWitnessOptions['theme'];
  /** Exact supported font bytes; ownership and license remain the host's responsibility. */
  readonly fonts: readonly SvgWitnessFont[];
  /** One explicit engine; no automatic fallback. Defaults to Chromium. */
  readonly browser?: 'chromium' | 'firefox' | 'webkit';
  /** Cancels setup and outstanding observations, then closes the owned browser. */
  readonly signal?: AbortSignal;
};
/** Owned process and witness; callers must await dispose in finally. @public */
export type NodeSvgWitnessSession = {
  /** Importer-compatible port; failures produce unsupported receipts. */
  readonly witness: SvgPaintWitness;
  /** Observation preserving distinct typed host failure outcomes. */
  readonly observe: (request: SvgPaintRequest) => Promise<Result<SvgPaintReceipt, NodeSvgWitnessFailure>>;
  /** Idempotent shutdown; success requires observed exit of the owned process. */
  readonly dispose: () => Promise<Result<void, NodeSvgWitnessFailure>>;
};
const FAILURE_CODES = {
  'peer-missing': 'FLX_CLI_PEER_MISSING',
  'invalid-input': 'FLX_SVG_IMPORT_INVALID',
  unsupported: 'FLX_SVG_IMPORT_UNSUPPORTED',
  deadline: 'FLX_SVG_IMPORT_UNSUPPORTED',
  cancelled: 'FLX_SVG_IMPORT_UNSUPPORTED',
  cleanup: 'FLX_SVG_IMPORT_UNSUPPORTED',
  transport: 'FLX_SVG_IMPORT_UNSUPPORTED',
  busy: 'FLX_SVG_IMPORT_UNSUPPORTED',
  disposed: 'FLX_SVG_IMPORT_UNSUPPORTED',
} as const satisfies Record<NodeSvgWitnessFailureKind, Diagnostic['code']>;
export function nodeWitnessFailure(kind: NodeSvgWitnessFailureKind): Err<NodeSvgWitnessFailure> {
  const code = FAILURE_CODES[kind];
  return err({ kind, diagnostics: [{ code, severity: 'error', path: '', message: `Node SVG witness: ${kind}` }] });
}
