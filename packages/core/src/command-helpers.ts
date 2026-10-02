// The pieces the built-in command files share (FR-EXT-001): argument shapes, the id checks that make a bad
// argument COMMAND_ARGS rather than an invalid document, and the one transaction a command runs in.
import { type AnyRecord, err, jsonPointer, type RecordId, type Result } from '@fluxion/schema';
import { z } from 'zod';
import type { CommandContext } from './commands.js';
import type { Tx, TxFailure } from './transaction.js';

export const id: z.ZodString = z.string().min(1);
// tzap disable next-line StringLiteral: message text is not the contract (codes are)
const identityMessage = (key: string) => `"${key}" is a record's identity, not a field it can change`;
// fields of a patch; a record's identity is not a field (a patch that changed it would throw; M3 cp1 F4)
export const fields: z.ZodType<Record<string, unknown>> = z.record(z.string(), z.unknown()).superRefine((value, check) => {
  for (const key of ['id', 'type']) if (Object.hasOwn(value, key)) check.addIssue({ code: 'custom', path: [key], message: identityMessage(key) });
});
/** A record body: validated in full by the transaction, so only its identity is checked here. */
export const recordOf = (type: string): z.ZodType<{ id: string; type: string } & Record<string, unknown>> => z.looseObject({ id, type: z.literal(type) });
export const title = (key: string, text: string): { id: string; defaultMessage: string } => ({ id: `command.${key}`, defaultMessage: text });

export type Want = 'new' | string;

/**
 * The first id that is not what the command needs (`new`: unused; a type: an existing record of
 * it), as COMMAND_ARGS with an FLX_COMMAND_ARGS diagnostic at its argument path (a bad argument, not
 * an invalid document; M3 final F5); null when all fit.
 * Creating never replaces a record, and a command never touches another type (M3.17 review).
 */
export function checkIds(
  ctx: CommandContext,
  command: string,
  want: Want,
  ids: ReadonlyArray<readonly [ReadonlyArray<string | number>, string]>,
): Result<never, TxFailure> | null {
  for (const [path, x] of ids) {
    const problem = idProblem(ctx.store.get(x as RecordId), x, want);
    if (problem)
      return err({
        code: 'COMMAND_ARGS',
        message: `${command}: ${problem}`,
        diagnostics: [{ code: 'FLX_COMMAND_ARGS', severity: 'error', path: jsonPointer(['args', ...path]), message: problem }],
      });
  }
  return null;
}

/** COMMAND_ARGS for the first id `ids` lists twice (two new records cannot share one), or null. */
export function repeated(command: string, ids: readonly string[], at: string): Result<never, TxFailure> | null {
  const twice = ids.findIndex((x, i) => ids.indexOf(x) !== i);
  // tzap disable next-line EqualityOperator: a repeat is never the first entry
  if (twice < 0) return null;
  // tzap disable next-line StringLiteral: message text is not the contract (codes are)
  const problem = `"${ids[twice]}" is listed twice`;
  return err({
    code: 'COMMAND_ARGS',
    message: `${command}: ${problem}`,
    diagnostics: [{ code: 'FLX_COMMAND_ARGS', severity: 'error', path: jsonPointer(['args', at, twice, 'id']), message: problem }],
  });
}

/** Why `record` (stored under `x`) is not what `want` asks for, or undefined. */
function idProblem(record: AnyRecord | undefined, x: string, want: Want): string | undefined {
  if (want === 'new') return record ? `"${x}" already exists (a ${record.type})` : undefined;
  // tzap disable next-line StringLiteral: message text is not the contract (codes are)
  return record?.type === want ? undefined : `"${x}" is ${record ? `a ${record.type}` : 'missing'}, not a ${want}`;
}

/** The command's one transaction, with the options its caller passed (origin, mergeKey, meta). */
export const write = <R>(ctx: CommandContext, label: string, fn: (tx: Tx) => R): Result<R, TxFailure> => ctx.store.transact(label, fn, ctx.options);

/** COMMAND_ARGS for `command`, naming the argument `at` in the diagnostic. */
export function refuse(command: string, at: ReadonlyArray<string | number>, problem: string): Result<never, TxFailure> {
  return err({
    code: 'COMMAND_ARGS',
    message: `${command}: ${problem}`,
    diagnostics: [{ code: 'FLX_COMMAND_ARGS', severity: 'error', path: jsonPointer(['args', ...at]), message: problem }],
  });
}
