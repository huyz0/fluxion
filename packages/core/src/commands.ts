// Commands (03-core-engine §2, ADR-0014 §Commands): every mutation from UI, keyboard, AI, MCP and
// plugins is a registered command, so there is one audit path and one undo semantics.
import { type Diagnostic, err, jsonPointer, ok, type Result } from '@fluxion/schema';
import type { Registry } from './registry.js';
import type { Store } from './store.js';
import type { TxFailure, TxOptions, TxOrigin } from './transaction.js';

/**
 * A translatable text: a stable id and the English default (i18n).
 *
 * @public
 */
export type MessageDescriptor = {
  /** Stable message id. */
  readonly id: string;
  /** English text. */
  readonly defaultMessage: string;
};

/**
 * An argument schema: the part of a Zod schema commands use (Zod schemas satisfy it). Structural, so
 * commands with different argument types share one registry.
 *
 * @public
 */
export type ArgsSchema<A> = {
  /** Parse `value`: the typed arguments, or every issue with its path. */
  safeParse(value: unknown): ArgsParsed<A> | ArgsRejected;
};

/**
 * Arguments that matched their schema.
 *
 * @public
 */
export type ArgsParsed<A> = {
  /** Always `true`. */
  readonly success: true;
  /** The parsed arguments. */
  readonly data: A;
};

/**
 * One problem with an argument.
 *
 * @public
 */
export type ArgsIssue = {
  /** Where in the arguments. */
  readonly path: ReadonlyArray<PropertyKey>;
  /** What is wrong. */
  readonly message: string;
};

/**
 * Arguments that did not match their schema.
 *
 * @public
 */
export type ArgsRejected = {
  /** Always `false`. */
  readonly success: false;
  /** Every issue found. */
  readonly error: {
    /** The issues. */
    readonly issues: ReadonlyArray<ArgsIssue>;
  };
};

/**
 * Transaction options a command caller may pass: every {@link TxOptions} field, but the origin is
 * never `undo` or `redo`. Those belong to the history module: they skip integrity hooks and are not
 * recorded, so a command run with them could corrupt history (ADR-0014; M3 final F2).
 *
 * @public
 */
export type CommandTxOptions = Omit<TxOptions, 'origin'> & {
  /** Who made the change (default `user`); `undo` and `redo` are refused. */
  readonly origin?: Exclude<TxOrigin, 'undo' | 'redo'>;
};

/**
 * What a command runs against.
 *
 * @public
 */
export type CommandContext = {
  /** The document store; `run` writes through `store.transact`. */
  readonly store: Store;
  /**
   * Options for the command's transaction (origin, mergeKey, metaBefore/metaAfter): a command is the
   * only production write path, so it carries what the write needs (ADR-0014; M3 cp1 F2).
   */
  readonly options?: CommandTxOptions;
};

/** History-only origins a command caller may not pass (checked at run time for untyped callers). */
const HISTORY_ORIGINS: ReadonlySet<string> = new Set(['undo', 'redo']);

/**
 * A command: id, title, Zod-validated arguments, an optional availability test, and `run`, the only
 * place production code writes (through `ctx.store.transact`).
 *
 * @public
 */
export type CommandDef<A> = {
  /** Registry key, e.g. `element.update`. */
  readonly id: string;
  /** Menu / palette title. */
  readonly title: MessageDescriptor;
  /** Argument schema (a Zod schema); also exported to the AI catalogue and MCP. */
  readonly args: ArgsSchema<A>;
  /** Whether the command is available now (default: always). */
  when?(ctx: CommandContext): boolean;
  /** Do the work; returns the transaction's result. */
  run(ctx: CommandContext, args: A): Result<unknown, TxFailure>;
};

/**
 * A registered command of any argument type (`run` is a method, so its parameter is bivariant).
 *
 * @public
 */
export type AnyCommand = CommandDef<unknown>;

/**
 * Why a command did not run or did not commit; the store is unchanged.
 *
 * @public
 */
export type CommandFailure = TxFailure;

/**
 * Identity helper that infers `A` from the schema.
 *
 * @public
 */
export function defineCommand<A>(def: CommandDef<A>): CommandDef<A> {
  return def;
}

const fail = (code: CommandFailure['code'], message: string, diagnostics: Diagnostic[]): Result<never, CommandFailure> => err({ code, message, diagnostics });

/**
 * Run the command `id` with `args`: unknown ids, an undo/redo origin, a read-only store, a false `when`
 * and arguments that fail the schema return diagnostics without running anything; otherwise the
 * command's transaction result.
 *
 * @public
 */
export function executeCommand(registry: Registry<string, AnyCommand>, ctx: CommandContext, id: string, args: unknown): Result<unknown, CommandFailure> {
  const command = registry.get(id);
  const at = jsonPointer(['commands', id]);
  if (!command)
    return fail('COMMAND_UNKNOWN', `no command "${id}"`, [
      { code: 'FLX_COMMAND_UNKNOWN', severity: 'error', path: at, message: `no command "${id}" is registered` },
    ]);
  // undo/redo origins skip hooks and history: only the history module may use them (M3 final F2)
  const origin: unknown = ctx.options?.origin;
  if (typeof origin === 'string' && HISTORY_ORIGINS.has(origin))
    return fail('COMMAND_ARGS', `${id}: origin "${origin}" is reserved for undo and redo`, [
      { code: 'FLX_COMMAND_ARGS', severity: 'error', path: jsonPointer(['options', 'origin']), message: `a command cannot run with origin "${origin}"` },
    ]);
  // a read-only store refuses before the command runs (ADR-0014 §Forks and policy)
  if (ctx.store.readOnly)
    return fail('TX_READ_ONLY', `${id}: the store is read-only`, [
      { code: 'FLX_READ_ONLY', severity: 'error', path: at, message: 'the document is read-only' },
    ]);
  if (command.when && !command.when(ctx))
    return fail('COMMAND_DISABLED', `${id} is not available`, [
      { code: 'FLX_COMMAND_DISABLED', severity: 'error', path: at, message: `${id} is not available now` },
    ]);
  const parsed = command.args.safeParse(args);
  if (!parsed.success) {
    const diagnostics: Diagnostic[] = parsed.error.issues.map((issue) => ({
      code: 'FLX_COMMAND_ARGS',
      severity: 'error',
      path: jsonPointer(['args', ...issue.path.map((p) => (typeof p === 'symbol' ? String(p) : p))]),
      message: issue.message,
    }));
    return fail('COMMAND_ARGS', `${id}: ${diagnostics.length} invalid argument(s)`, diagnostics);
  }
  return command.run(ctx, parsed.data);
}
