// Built-in record commands (FR-EXT-001, NFR-MNT-006): the basic writes every client needs, registered
// through the same registry as plugin commands. Each `run` is one transaction; integrity hooks and
// validation do the rest (ADR-0014).
import { type AnyRecord, compareKeys, type Diagnostic, err, jsonPointer, keyBetween, ok, type RecordId, type Result } from '@fluxion/schema';
import { z } from 'zod';
import { type AnyCommand, type CommandContext, defineCommand } from './commands.js';
import type { Registry } from './registry.js';
import type { TxFailure } from './transaction.js';

const id = z.string().min(1);
// fields of a patch; a record's identity is not a field (a patch that changed it would throw; M3 cp1 F4)
const fields = z.record(z.string(), z.unknown()).superRefine((value, check) => {
  for (const key of ['id', 'type'])
    if (Object.hasOwn(value, key)) check.addIssue({ code: 'custom', path: [key], message: `"${key}" is a record's identity, not a field it can change` });
});
/** A record body: validated in full by the transaction, so only its identity is checked here. */
const recordOf = (type: string) => z.looseObject({ id, type: z.literal(type) });
const title = (key: string, text: string) => ({ id: `command.${key}`, defaultMessage: text });

type Want = 'new' | string;

/**
 * The first id that is not what the command needs (`new`: unused; a type: an existing record of
 * it), as TX_INVALID with an FLX_COMMAND_ARGS diagnostic at its argument path; null when all fit.
 * Creating never replaces a record, and a command never touches another type (M3.17 review).
 */
function checkIds(
  ctx: CommandContext,
  command: string,
  want: Want,
  ids: ReadonlyArray<readonly [ReadonlyArray<string | number>, string]>,
): Result<never, TxFailure> | null {
  for (const [path, x] of ids) {
    const problem = idProblem(ctx.store.get(x as RecordId), x, want);
    if (problem)
      return err({
        code: 'TX_INVALID',
        message: `${command}: ${problem}`,
        diagnostics: [{ code: 'FLX_COMMAND_ARGS', severity: 'error', path: jsonPointer(['args', ...path]), message: problem }],
      });
  }
  return null;
}

/** Why `record` (stored under `x`) is not what `want` asks for, or undefined. */
function idProblem(record: AnyRecord | undefined, x: string, want: Want): string | undefined {
  if (want === 'new') return record ? `"${x}" already exists (a ${record.type})` : undefined;
  return record?.type === want ? undefined : `"${x}" is ${record ? `a ${record.type}` : 'missing'}, not a ${want}`;
}

/** The screens in order, without `except`. */
function screensInOrder(ctx: CommandContext, except: string): Array<{ readonly id: RecordId; readonly index: string }> {
  return ctx.store
    .members('byType', 'screen')
    .filter((s) => s !== except)
    .map((s) => ({ id: s, index: String((ctx.store.get(s) as { index?: unknown } | undefined)?.index ?? '') }))
    .sort((a, b) => compareKeys(a.index, b.index));
}

/** The index that puts a screen right after `after` (first when absent), or why none exists. */
function indexAfter(ctx: CommandContext, screen: string, after: string | undefined): Result<string, TxFailure> {
  const others = screensInOrder(ctx, screen);
  const at = after === undefined ? 0 : others.findIndex((s) => s.id === after) + 1;
  if (after !== undefined && at === 0) return err({ code: 'TX_INVALID', message: `screen.reorder: no screen ${after}`, diagnostics: [] });
  const key = keyBetween(others[at - 1]?.index ?? null, others[at]?.index ?? null);
  return key.ok ? ok(key.value) : err({ code: 'TX_INVALID', message: `screen.reorder: ${key.error.message}`, diagnostics: [] });
}

/** The binding holding `end` of `connectorId`, if any. */
function bindingAt(ctx: CommandContext, connectorId: string, end: string): RecordId | undefined {
  return ctx.store.members('bindingsByElement', connectorId).find((b) => {
    const r = ctx.store.get(b) as { connectorId?: unknown; end?: unknown } | undefined;
    return r?.connectorId === connectorId && r.end === end;
  });
}

const endSchema = z.enum(['source', 'target']);

/**
 * The built-in record commands (FR-EXT-001).
 *
 * @public
 */
export const CORE_COMMANDS: readonly AnyCommand[] = [
  defineCommand({
    id: 'element.create',
    title: title('element.create', 'Add element'),
    args: z.object({ element: recordOf('element') }),
    run: (ctx, args) =>
      checkIds(ctx, 'element.create', 'new', [[['element', 'id'], args.element.id]]) ??
      ctx.store.transact('element.create', (tx) => tx.put(args.element as AnyRecord)),
  }),
  defineCommand({
    id: 'element.update',
    title: title('element.update', 'Change element'),
    args: z.object({ id, fields }),
    run: (ctx, args) =>
      checkIds(ctx, 'element.update', 'element', [[['id'], args.id]]) ??
      ctx.store.transact('element.update', (tx) => tx.patch(args.id as RecordId, args.fields)),
  }),
  defineCommand({
    id: 'element.delete',
    title: title('element.delete', 'Delete elements'),
    args: z.object({ ids: z.array(id).min(1) }),
    run: (ctx, args) =>
      checkIds(
        ctx,
        'element.delete',
        'element',
        args.ids.map((x, i) => [['ids', i], x] as const),
      ) ??
      ctx.store.transact('element.delete', (tx) => {
        for (const x of args.ids) tx.delete(x as RecordId);
      }),
  }),
  defineCommand({
    id: 'screen.create',
    title: title('screen.create', 'Add screen'),
    args: z.object({ screen: recordOf('screen') }),
    run: (ctx, args) =>
      checkIds(ctx, 'screen.create', 'new', [[['screen', 'id'], args.screen.id]]) ??
      ctx.store.transact('screen.create', (tx) => tx.put(args.screen as AnyRecord)),
  }),
  defineCommand({
    id: 'screen.delete',
    title: title('screen.delete', 'Delete screen'),
    args: z.object({ id }),
    run: (ctx, args) =>
      checkIds(ctx, 'screen.delete', 'screen', [[['id'], args.id]]) ?? ctx.store.transact('screen.delete', (tx) => tx.delete(args.id as RecordId)),
  }),
  defineCommand({
    id: 'screen.reorder',
    title: title('screen.reorder', 'Move screen'),
    // `after`: the screen it should follow; absent → first. Only the moved screen changes (FR-DOC-010).
    args: z.object({ id, after: id.optional() }),
    run: (ctx, args) => {
      const refs: Array<readonly [ReadonlyArray<string>, string]> = [[['id'], args.id]];
      if (args.after !== undefined) refs.push([['after'], args.after]);
      const bad = checkIds(ctx, 'screen.reorder', 'screen', refs);
      if (bad) return bad;
      const index = indexAfter(ctx, args.id, args.after);
      if (!index.ok) return index;
      return ctx.store.transact('screen.reorder', (tx) => tx.patch(args.id as RecordId, { index: index.value }));
    },
  }),
  defineCommand({
    id: 'binding.set',
    title: title('binding.set', 'Attach connector end'),
    // binds one end of a connector: an existing binding of that end is re-pointed, else `id` is created
    args: z.object({ id, connectorId: id, end: endSchema, elementId: id, anchor: z.looseObject({ kind: z.string() }) }),
    run: (ctx, args) => {
      const existing = bindingAt(ctx, args.connectorId, args.end);
      const ends: Array<readonly [ReadonlyArray<string>, string]> = [
        [['connectorId'], args.connectorId],
        [['elementId'], args.elementId],
      ];
      const bad = checkIds(ctx, 'binding.set', 'element', ends) ?? (existing ? null : checkIds(ctx, 'binding.set', 'new', [[['id'], args.id]]));
      if (bad) return bad;
      const binding = {
        id: existing ?? args.id,
        type: 'binding',
        connectorId: args.connectorId,
        end: args.end,
        elementId: args.elementId,
        anchor: args.anchor,
      };
      const free = args.end === 'source' ? 'freeSource' : 'freeTarget';
      return ctx.store.transact('binding.set', (tx) => {
        tx.put(binding as unknown as AnyRecord);
        // a bound end has no free point (FLX_CONNECTOR_END_CONFLICT otherwise)
        if ((tx.get(args.connectorId as RecordId) as Record<string, unknown> | undefined)?.[free] !== undefined)
          tx.patch(args.connectorId as RecordId, { [free]: undefined });
      });
    },
  }),
  defineCommand({
    id: 'document.update',
    title: title('document.update', 'Change document'),
    args: z.object({ fields }),
    run: (ctx, args) => {
      // a store without its document singleton is refused, not patched (M3 cp1 F4)
      const doc = ctx.store.members('byType', 'document')[0] ?? '';
      return checkIds(ctx, 'document.update', 'document', [[[], doc]]) ?? ctx.store.transact('document.update', (tx) => tx.patch(doc as RecordId, args.fields));
    },
  }),
];

/**
 * Register the built-in commands as source `core`; returns the refused registrations (a plugin
 * already holding an id), so a missing built-in is never silent.
 *
 * @public
 */
export function registerCoreCommands(registry: Registry<string, AnyCommand>): Diagnostic[] {
  return CORE_COMMANDS.flatMap((command) => {
    const r = registry.register(command.id, command, 'core');
    return r.ok ? [] : [r.error];
  });
}
