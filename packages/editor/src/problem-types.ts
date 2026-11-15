// The shape of a document problem and its fix (FR-EDT-021): what problems.ts and region-problems.ts report and the Problems tab shows.
import type { RecordId } from '@fluxion/schema';

/**
 * A fix: a document command with its arguments.
 *
 * @public
 */
export type ProblemFix = {
  /** What the button says. */
  readonly title: string;
  /** The document command to run. */
  readonly command: string;
  /** Its arguments. */
  readonly args: unknown;
};

/**
 * One problem of the document.
 *
 * @public
 */
export type Problem = {
  /** Stable while the problem stands: its code and the records it is about. */
  readonly id: string;
  /** How serious it is. */
  readonly severity: 'error' | 'warning' | 'info';
  /** One line for people. */
  readonly message: string;
  /** The elements it is about (the panel selects them). */
  readonly elements: readonly RecordId[];
  /** How to fix it, when a command can. */
  readonly fix?: ProblemFix;
};
