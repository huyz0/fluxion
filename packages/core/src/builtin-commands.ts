// Built-in record commands (FR-EXT-001, NFR-MNT-006): the basic writes every client needs, registered
// through the same registry as plugin commands. Each `run` is one transaction; integrity hooks and
// validation do the rest (ADR-0014).
import {
  type AnyRecord,
  compareKeys,
  DIAGNOSTIC_CODES,
  type Diagnostic,
  err,
  isIndexKey,
  jsonPointer,
  keyBetween,
  ok,
  type RecordId,
  type Result,
} from '@fluxion/schema';
import { z } from 'zod';
import { ALIGN_COMMANDS } from './arrange/align.js';
import { DISTRIBUTE_COMMANDS } from './arrange/distribute.js';
import { GROUP_COMMANDS } from './arrange/group.js';
import { Z_ORDER_COMMANDS } from './arrange/z-order.js';
import { checkIds, fields, id, recordOf, refuse, repeated, title, write } from './command-helpers.js';
import { type AnyCommand, type CommandContext, defineCommand } from './commands.js';
import {
  CREATE_ASSET,
  CREATE_ELEMENT,
  CREATE_ELEMENTS,
  DELETE_ASSET,
  DELETE_ELEMENTS,
  UPDATE_ASSET,
  UPDATE_ELEMENT,
  UPDATE_ELEMENTS,
} from './record-commands.js';
import type { Registry } from './registry.js';
import { SCREEN_COMMANDS } from './screens/screen-commands.js';
import { screenIndexAfter } from './screens/screen-order.js';
import { SECTION_COMMANDS } from './screens/section-commands.js';
import { THEME_COMMANDS } from './theme-commands.js';
import type { TxFailure } from './transaction.js';

/** The binding holding `end` of `connectorId`, if any. */
function bindingAt(ctx: CommandContext, connectorId: string, end: string): RecordId | undefined {
  return ctx.store.members('bindingsByElement', connectorId).find((b) => {
    const r = ctx.store.get(b) as { connectorId?: unknown; end?: unknown } | undefined;
    return r?.connectorId === connectorId && r.end === end;
  });
}

type ApplyArgs = { puts: ReadonlyArray<{ id: string; type: string }>; deletes: readonly string[] };
const APPLY = 'document.applyRecords';

/** The delete half of document.applyRecords' guards: an existing record, once, not the document, and not also put. */
function deleteGuard(ctx: CommandContext, args: ApplyArgs): Result<never, TxFailure> | null {
  const put = new Set(args.puts.map((r) => r.id));
  for (const [i, x] of args.deletes.entries()) {
    if (put.has(x)) return refuse(APPLY, ['deletes', i], `"${x}" is both put and deleted`);
    if (args.deletes.indexOf(x) !== i) return refuse(APPLY, ['deletes', i], `"${x}" is deleted twice`);
    const current = ctx.store.get(x as RecordId);
    if (!current) return refuse(APPLY, ['deletes', i], `"${x}" does not exist`);
    if (current.type === 'document') return refuse(APPLY, ['deletes', i], 'the document record cannot be deleted');
  }
  return null;
}

/**
 * document.applyRecords' guards (a built-in never touches another type): a put keeps the type of the record it replaces and a record is put once;
 * a delete names an existing record once, never the document record, and no id is both put and deleted.
 */
function applyGuard(ctx: CommandContext, args: ApplyArgs): Result<never, TxFailure> | null {
  const twice = repeated(
    APPLY,
    args.puts.map((r) => r.id),
    'puts',
  );
  if (twice) return twice;
  for (const [i, r] of args.puts.entries()) {
    const current = ctx.store.get(r.id as RecordId);
    if (current && current.type !== r.type) return refuse(APPLY, ['puts', i, 'type'], `"${r.id}" is a ${current.type}, a put cannot make it a ${r.type}`);
  }
  return deleteGuard(ctx, args);
}

const endSchema = z.enum(['source', 'target']);

/**
 * The built-in record commands (FR-EXT-001).
 *
 * @public
 */
export const CORE_COMMANDS: readonly AnyCommand[] = [
  ...GROUP_COMMANDS,
  ...ALIGN_COMMANDS,
  ...DISTRIBUTE_COMMANDS,
  ...Z_ORDER_COMMANDS,
  ...SCREEN_COMMANDS,
  ...SECTION_COMMANDS,
  ...THEME_COMMANDS,
  CREATE_ELEMENT,
  UPDATE_ELEMENT,
  CREATE_ASSET,
  UPDATE_ASSET,
  DELETE_ASSET,
  DELETE_ELEMENTS,
  CREATE_ELEMENTS,
  UPDATE_ELEMENTS,
  defineCommand({
    id: 'screen.create',
    title: title('screen.create', 'Add screen'),
    args: z.object({ screen: recordOf('screen') }),
    run: (ctx, args) =>
      checkIds(ctx, 'screen.create', 'new', [[['screen', 'id'], args.screen.id]]) ?? write(ctx, 'screen.create', (tx) => tx.put(args.screen as AnyRecord)),
  }),
  defineCommand({
    id: 'screen.delete',
    title: title('screen.delete', 'Delete screen'),
    args: z.object({ id }),
    run: (ctx, args) => checkIds(ctx, 'screen.delete', 'screen', [[['id'], args.id]]) ?? write(ctx, 'screen.delete', (tx) => tx.delete(args.id as RecordId)),
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
      const index = screenIndexAfter(ctx, 'screen.reorder', args.id, args.after);
      if (!index.ok) return index;
      return write(ctx, 'screen.reorder', (tx) => tx.patch(args.id as RecordId, { index: index.value }));
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
      return write(ctx, 'binding.set', (tx) => {
        tx.put(binding as unknown as AnyRecord);
        // a bound end has no free point (FLX_CONNECTOR_END_CONFLICT otherwise); removing an absent
        // one nets to nothing, so the connector is patched unconditionally
        tx.patch(args.connectorId as RecordId, { [free]: undefined });
      });
    },
  }),
  defineCommand({
    id: 'connector.freeEnd',
    title: title('connector.freeEnd', 'Free connector end'),
    // lets go of one end: its binding goes and the end is held at `at` instead (a bound end can otherwise only be re-pointed)
    args: z.object({ connectorId: id, end: endSchema, at: z.object({ x: z.number().finite(), y: z.number().finite() }) }),
    run: (ctx, args) => {
      const bad = checkIds(ctx, 'connector.freeEnd', 'element', [[['connectorId'], args.connectorId]]);
      if (bad) return bad;
      const bound = bindingAt(ctx, args.connectorId, args.end);
      const free = args.end === 'source' ? 'freeSource' : 'freeTarget';
      return write(ctx, 'connector.freeEnd', (tx) => {
        // the free point first, so the hook that frees a deleted binding's end finds it held
        tx.patch(args.connectorId as RecordId, { [free]: args.at });
        if (bound !== undefined) tx.delete(bound);
      });
    },
  }),
  // a prepared record set written at once: what a streamed or imported source makes of the document, one screen after another. Records are
  // put whole (new or replacing), the listed ids deleted; the transaction nets it, validates it and runs the hooks (FR-AI-010)
  defineCommand({
    id: 'document.applyRecords',
    title: title('document.applyRecords', 'Apply records'),
    args: z.object({ puts: z.array(z.looseObject({ id, type: id })), deletes: z.array(id) }),
    run: (ctx, args) =>
      applyGuard(ctx, args) ??
      write(ctx, 'document.applyRecords', (tx) => {
        for (const r of args.puts) tx.put(r as AnyRecord);
        for (const x of args.deletes) tx.delete(x as RecordId);
      }),
  }),
  defineCommand({
    id: 'document.update',
    title: title('document.update', 'Change document'),
    args: z.object({ fields }),
    run: (ctx, args) => {
      // a store without its document singleton is refused, not patched (M3 cp1 F4)
      const docs = ctx.store.members('byType', 'document');
      // tzap disable next-line StringLiteral: any id absent from the store is refused alike (COMMAND_ARGS at /args); the fallback only shows in message text
      const doc = docs[0] ?? '';
      return checkIds(ctx, 'document.update', 'document', [[[], doc]]) ?? write(ctx, 'document.update', (tx) => tx.patch(doc as RecordId, args.fields));
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
