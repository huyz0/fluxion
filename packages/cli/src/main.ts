// The `fluxion` command line (ADR-0147, FR-CLI-001, contracts.md §6): a command table, strict
// `node:util.parseArgs` per command, exit codes 0/1/2/3, and with `--json` one reply object on
// stdout, parsed by its schema (output.ts) before it is printed. `run` takes the argument list and
// an IO port and returns the exit code, so tests run it in-process as well as through the built bin.
import { parseArgs } from 'node:util';
import { type Diagnostic, jsonPointer } from '@fluxion/schema';
import { API_VERSION, OUTPUT_SCHEMAS } from './output.js';

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
type Outcome = { readonly exitCode: ExitCode; readonly diagnostics: readonly Diagnostic[]; readonly result?: unknown };

type Options = NonNullable<NonNullable<Parameters<typeof parseArgs>[0]>['options']>;

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

/** A command whose implementation lands in a later row (M4.18, M4.20): an internal error until then. */
const notYet =
  (name: string): Command['run'] =>
  (_args, io) => {
    io.stderr(`fluxion ${name}: not available in this build yet\n`);
    return { exitCode: 3, diagnostics: [] };
  };

const COMMANDS: { readonly [name: string]: Command } = {
  validate: { summary: 'Check a document and list its diagnostics', usage: 'validate <file>', options: {}, run: notYet('validate') },
  render: {
    summary: 'Render a document to a static HTML file',
    usage: 'render <file> -o <out.html> [--screen <id>]',
    options: { out: { type: 'string', short: 'o' }, screen: { type: 'string', multiple: true } },
    run: notYet('render'),
  },
};

const GLOBAL: Options = { help: { type: 'boolean', short: 'h' }, version: { type: 'boolean' }, json: { type: 'boolean' } };

/** The version the bin reports. */
const CLI_VERSION = '0.0.0';

function helpText(): string {
  const width = Math.max(...Object.keys(COMMANDS).map((n) => n.length));
  const list = Object.entries(COMMANDS).map(([name, c]) => `  ${name.padEnd(width)}  ${c.summary}`);
  const options = ['  -h, --help  Show help', '  --version   Show the version', '  --json      Print one JSON reply on stdout'];
  return ['Usage: fluxion <command> [options]', '', 'Commands:', ...list, '', 'Options:', ...options, ''].join('\n');
}

const usage = (message: string, at: readonly (string | number)[] = ['argv']): Outcome => ({
  exitCode: 2,
  diagnostics: [{ code: 'FLX_CLI_USAGE', severity: 'error', path: jsonPointer(at), message, hint: 'Run fluxion --help.' }],
});

const ok = (result: unknown): Outcome => ({ exitCode: 0, diagnostics: [], result });

/** The arguments before `--` (after it, every argument is a positional, never an option). */
const options = (argv: readonly string[]) => (argv.includes('--') ? argv.slice(0, argv.indexOf('--')) : argv);

/** Where the command name is, if any: the first argument before `--` that is not an option. */
function locate(argv: readonly string[]): { readonly index: number; readonly name: string | undefined } {
  const index = options(argv).findIndex((a) => !a.startsWith('-'));
  return { index, name: index < 0 ? undefined : argv[index] };
}

/** `fluxion` with no command: help, the version, or a usage error. */
function withoutCommand(argv: readonly string[]): Outcome {
  const flags = options(argv);
  if (flags.includes('--version')) return ok({ version: CLI_VERSION });
  if (flags.includes('--help') || flags.includes('-h')) return ok({ help: helpText() });
  return usage('no command given');
}

/** One command's line: parsed strictly with the global options; its help or the version, or its run. */
async function withCommand(command: Command, rest: readonly string[], io: CliIo): Promise<Outcome> {
  let parsed: { values: Record<string, unknown>; positionals: string[] };
  try {
    parsed = parseArgs({ args: [...rest], options: { ...GLOBAL, ...command.options }, allowPositionals: true, strict: true });
  } catch (e) {
    return usage(e instanceof Error ? e.message : String(e));
  }
  if (parsed.values['version'] === true) return ok({ version: CLI_VERSION });
  if (parsed.values['help'] === true) return ok({ help: `Usage: fluxion ${command.usage}\n\n${command.summary}.\n` });
  return command.run(parsed, io);
}

/** The reply object of `outcome` (contracts.md rule 13): `result` when ok, `errors[]` otherwise. */
function reply(command: string | null, outcome: Outcome): unknown {
  const base = { apiVersion: API_VERSION, command, ok: outcome.exitCode === 0, exitCode: outcome.exitCode };
  return outcome.exitCode === 0 ? { ...base, result: outcome.result ?? {} } : { ...base, errors: outcome.diagnostics };
}

/** Writes the outcome: diagnostics to stderr, then the reply (json) or the requested text. */
function report(command: string | null, outcome: Outcome, json: boolean, io: CliIo): ExitCode {
  for (const d of outcome.diagnostics) io.stderr(`${d.severity} ${d.code} ${d.path}: ${d.message}${d.hint ? ` (${d.hint})` : ''}\n`);
  if (json) {
    const checked = OUTPUT_SCHEMAS[command ?? 'fluxion']?.safeParse(reply(command, outcome));
    if (!checked?.success) {
      // a reply outside its schema is our bug: say so, and still print a reply that conforms
      io.stderr(`fluxion: internal error: the reply does not match its schema: ${checked?.error.message ?? 'no schema'}\n`);
      io.stdout(`${JSON.stringify(reply(command, { exitCode: 3, diagnostics: [] }))}\n`);
      return 3;
    }
    io.stdout(`${JSON.stringify(checked.data)}\n`);
    return outcome.exitCode;
  }
  // help and version are the requested output in human mode; with --json they are the result
  const { help, version } = (outcome.result ?? {}) as { readonly help?: unknown; readonly version?: unknown };
  if (typeof help === 'string') io.stdout(help);
  if (typeof version === 'string') io.stdout(`${version}\n`);
  return outcome.exitCode;
}

/**
 * Run the command line `argv` (without the node and script paths), writing to `io`; resolves to the
 * exit code (ADR-0147).
 *
 * @public
 */
export function run(argv: readonly string[], io: CliIo): Promise<ExitCode> {
  return runCommands(COMMANDS, argv, io);
}

/** {@link run} over a given command table (tests pass one with a failing or throwing command). */
export async function runCommands(commands: { readonly [name: string]: Command }, argv: readonly string[], io: CliIo): Promise<ExitCode> {
  const { index, name } = locate(argv);
  const command = name === undefined ? undefined : commands[name];
  const known = command === undefined ? null : (name as string);
  let outcome: Outcome;
  try {
    if (name === undefined) outcome = withoutCommand(argv);
    else if (command === undefined) outcome = usage(`unknown command "${name}"`, ['argv', index]);
    else outcome = await withCommand(command, argv.toSpliced(index, 1), io);
  } catch (e) {
    io.stderr(`fluxion: internal error: ${e instanceof Error ? e.message : String(e)}\n`);
    outcome = { exitCode: 3, diagnostics: [] };
  }
  return report(known, outcome, options(argv).includes('--json'), io);
}
