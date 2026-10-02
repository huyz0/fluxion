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
import { checkIds, fields, id, recordOf, repeated, title, write } from './command-helpers.js';
import { type AnyCommand, type CommandContext, defineCommand } from './commands.js';
import type { Registry } from './registry.js';
import type { TxFailure } from './transaction.js';

/** The screens in order, without `except`. */
function screensInOrder(ctx: CommandContext, except: string): Array<{ readonly id: RecordId; readonly index: string }> {
  return ctx.store
    .members('byType', 'screen')
    .filter((s) => s !== except)
    .map((s) => ({ id: s, index: String((ctx.store.get(s) as { index?: unknown } | undefined)?.index ?? '') }))
    .sort((a, b) => compareKeys(a.index, b.index));
}

/**
 * The index that puts a screen right after `after` (first when absent), or why none exists: a screen
 * cannot follow itself (COMMAND_ARGS), and neighbours with equal or malformed keys have no key between
 * them (TX_INVALID naming the neighbour's index; M3 final F5).
 */
function indexAfter(ctx: CommandContext, screen: string, after: string | undefined): Result<string, TxFailure> {
  const others = screensInOrder(ctx, screen);
  // no screen has an undefined id, so an absent `after` finds nothing: at 0, first
  const at = others.findIndex((s) => s.id === after) + 1;
  if (after !== undefined && at === 0) {
    const message = 'a screen cannot follow itself';
    return err({
      code: 'COMMAND_ARGS',
      message: `screen.reorder: ${message}`,
      diagnostics: [{ code: 'FLX_COMMAND_ARGS', severity: 'error', path: jsonPointer(['args', 'after']), message }],
    });
  }
  const [before, next] = [others[at - 1], others[at]];
  const key = keyBetween(before?.index ?? null, next?.index ?? null);
  if (key.ok) return ok(key.value);
  // an equal pair names the later key; a malformed key names the neighbour holding it (M4.4 review F1);
  // the severity is the code's registered one (review F2)
  const malformed = [before, next].find((s) => s !== undefined && !isIndexKey(s.index));
  // (an out-of-order pair has two valid keys, so no malformed one: it names `next` too)
  const neighbour = malformed ?? next ?? before;
  const code = key.error.code === 'INDEX_ORDER' ? 'FLX_INDEX_DUPLICATE' : 'FLX_SCHEMA_INVALID';
  const found: Diagnostic = {
    code,
    severity: DIAGNOSTIC_CODES[code],
    path: jsonPointer(['records', neighbour?.id ?? screen, 'index']),
    message: key.error.message,
  };
  return err({ code: 'TX_INVALID', message: `screen.reorder: ${key.error.message}`, diagnostics: [found] });
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
  ...GROUP_COMMANDS,
  ...ALIGN_COMMANDS,
  ...DISTRIBUTE_COMMANDS,
  defineCommand({
    id: 'element.create',
    title: title('element.create', 'Add element'),
    args: z.object({ element: recordOf('element') }),
    run: (ctx, args) =>
      checkIds(ctx, 'element.create', 'new', [[['element', 'id'], args.element.id]]) ?? write(ctx, 'element.create', (tx) => tx.put(args.element as AnyRecord)),
  }),
  defineCommand({
    id: 'element.update',
    title: title('element.update', 'Change element'),
    args: z.object({ id, fields }),
    run: (ctx, args) =>
      checkIds(ctx, 'element.update', 'element', [[['id'], args.id]]) ?? write(ctx, 'element.update', (tx) => tx.patch(args.id as RecordId, args.fields)),
  }),
  // an asset's record (its bytes are the host's): what a paste of an image makes beside the image element (M7.23)
  defineCommand({
    id: 'asset.create',
    title: title('asset.create', 'Add asset'),
    args: z.object({ asset: recordOf('asset') }),
    run: (ctx, args) =>
      checkIds(ctx, 'asset.create', 'new', [[['asset', 'id'], args.asset.id]]) ?? write(ctx, 'asset.create', (tx) => tx.put(args.asset as AnyRecord)),
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
      write(ctx, 'element.delete', (tx) => {
        for (const x of args.ids) tx.delete(x as RecordId);
      }),
  }),
  // several elements in one transaction: what the editor's gestures and tools change at once (a move of
  // a selection, a duplicate), one undo step and one diff (ADR-0028 amendment, M6.14)
  defineCommand({
    id: 'element.createMany',
    title: title('element.createMany', 'Add elements'),
    args: z.object({ elements: z.array(recordOf('element')).min(1) }),
    run: (ctx, args) =>
      repeated(
        'element.createMany',
        args.elements.map((e) => e.id),
        'elements',
      ) ??
      checkIds(
        ctx,
        'element.createMany',
        'new',
        args.elements.map((e, i) => [['elements', i, 'id'], e.id] as const),
      ) ??
      write(ctx, 'element.createMany', (tx) => {
        for (const e of args.elements) tx.put(e as AnyRecord);
      }),
  }),
  defineCommand({
    id: 'element.updateMany',
    title: title('element.updateMany', 'Change elements'),
    args: z.object({ updates: z.array(z.object({ id, fields })).min(1) }),
    run: (ctx, args) =>
      checkIds(
        ctx,
        'element.updateMany',
        'element',
        args.updates.map((u, i) => [['updates', i, 'id'], u.id] as const),
      ) ??
      write(ctx, 'element.updateMany', (tx) => {
        for (const u of args.updates) tx.patch(u.id as RecordId, u.fields);
      }),
  }),
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
      const index = indexAfter(ctx, args.id, args.after);
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
