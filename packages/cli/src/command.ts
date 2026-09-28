// What every command shares (ADR-0147): the IO port, exit codes, the outcome a command returns, and
// the diagnostics the command line itself reports (usage, IO, internal errors).
import type { parseArgs } from 'node:util';
import { type Diagnostic, jsonPointer } from '@fluxion/schema';

/**
 * Where the CLI writes; the bin passes process.stdout and process.stderr.
 *
 * @public
 */
export type CliIo = {
  /** Machine-readable output (the `--json` reply) and requested output such as help. */
  readonly stdout: (text: string) => void;
  /** Human messages: errors, warnings, progress. */
  readonly stderr: (text: string) => void;
};

/**
 * An exit code of the CLI (contracts.md rule 14): 0 ok, 1 input errors, 2 usage error, 3 internal
 * error.
 *
 * @public
 */
export type ExitCode = 0 | 1 | 2 | 3;

/** What a command returns: its exit code, what it reported, and its result when it succeeds. */
export type Outcome = { readonly exitCode: ExitCode; readonly diagnostics: readonly Diagnostic[]; readonly result?: unknown };

/** The option table of `node:util.parseArgs`. */
export type Options = NonNullable<NonNullable<Parameters<typeof parseArgs>[0]>['options']>;

/** One command of the table. */
export type Command = {
  /** One line for the command list. */
  readonly summary: string;
  /** The usage line after `fluxion`. */
  readonly usage: string;
  /** Options besides the global ones. */
  readonly options: Options;
  /** Runs the command on its parsed values and positionals. */
  readonly run: (args: { readonly values: Record<string, unknown>; readonly positionals: readonly string[] }, io: CliIo) => Outcome | Promise<Outcome>;
};

/** A successful outcome with `result`. */
export const ok = (result: unknown): Outcome => ({ exitCode: 0, diagnostics: [], result });

/** A usage error (exit 2) at `at` in the command line. */
export const usage = (message: string, at: readonly (string | number)[] = ['argv']): Outcome => ({
  exitCode: 2,
  diagnostics: [{ code: 'FLX_CLI_USAGE', severity: 'error', path: jsonPointer(at), message, hint: 'Run fluxion --help.' }],
});

/** An internal error (exit 3): our fault, not the input's; the reason is machine-readable too. */
export const internal = (message: string): Outcome => ({
  exitCode: 3,
  diagnostics: [{ code: 'FLX_CLI_INTERNAL', severity: 'error', path: '', message, hint: 'Report it with the command line and the input.' }],
});

/** A file the command line names cannot be read or written (exit 1). */
export const io = (message: string, at: readonly (string | number)[]): Outcome => ({
  exitCode: 1,
  diagnostics: [{ code: 'FLX_CLI_IO', severity: 'error', path: jsonPointer(at), message }],
});
