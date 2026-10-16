// The quality linter's shapes (06-ai-authoring.md §7, FR-AI-005): a rule reads the laid-out document and says what looks wrong.
import type { Registry } from '@fluxion/core';
import type { Diagnostic, DiagnosticSeverity, DocumentFile, RecordId } from '@fluxion/schema';
import type { Theme } from '@fluxion/theme';

/**
 * The size of measured text.
 *
 * @public
 */
export type TextSize = {
  /** Width of the widest line (px). */
  readonly w: number;
  /** Height of all lines (px). */
  readonly h: number;
};

/**
 * Measures wrapped text: the size `text` takes in `font` when wrapped at `maxWidth` (the host's font metrics; the linter holds none).
 *
 * @public
 */
export type MeasureText = (text: string, font: { readonly family: string; readonly size: number; readonly weight: number }, maxWidth: number) => TextSize;

/**
 * What a rule may use besides the document.
 *
 * @public
 */
export type LintContext = {
  /** The theme the document's styles resolve against; without it the contrast rule has nothing to resolve. */
  readonly theme?: Theme;
  /** Text measurement; without it the overflow rule has nothing to measure. */
  readonly measureText?: MeasureText;
};

/**
 * One finding of a rule: a diagnostic with the elements it is about.
 *
 * @public
 */
export type LintFinding = Diagnostic & {
  /** The elements the finding is about (the Problems tab selects them). */
  readonly elements: readonly RecordId[];
};

/**
 * A lint rule.
 *
 * @public
 */
export type LintRule = {
  /** The short id, e.g. `OVERLAP`. */
  readonly id: string;
  /** The diagnostic code its findings carry. */
  readonly code: Diagnostic['code'];
  /** How serious a finding is. */
  readonly severity: DiagnosticSeverity;
  /** Points taken off the score per finding. */
  readonly weight: number;
  /** One line for the catalog and the docs. */
  readonly describe: string;
  /** The findings for `doc`; pure. */
  readonly check: (doc: DocumentFile, ctx: LintContext) => readonly LintFinding[];
};

/**
 * The `lintRules` registry as the linter sees it.
 *
 * @public
 */
export type LintRegistry = Registry<string, unknown>;

/**
 * The result of linting a document.
 *
 * @public
 */
export type LintReport = {
  /** 100 minus the sum of weight times findings over the rules, never below 0. */
  readonly score: number;
  /** Every finding, in rule order then document order. */
  readonly findings: readonly LintFinding[];
};
