// Group and ungroup (FR-ARR-001, M8.4). A group is a container element whose box is the bounds of its
// members; members keep their screen coordinates (the render side undoes the container's placement, 04 §2),
// so grouping and ungrouping change only `parentId`, the container record and the sibling order: no
// member's box moves and no binding is touched, connectors stay attached.
import { type AnyRecord, compareKeys, err, jsonPointer, keyBetween, ok, type RecordId, type Result } from '@fluxion/schema';
import { z } from 'zod';
import { checkIds, id, title, write } from '../command-helpers.js';
import { type AnyCommand, type CommandContext, defineCommand } from '../commands.js';
import type { TxFailure } from '../transaction.js';
import { boundsOfPlacements } from './group-bounds.js';

type Box = {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly rot?: number;
  readonly flipX?: boolean;
  readonly flipY?: boolean;
};
type El = {
  readonly id: RecordId;
  readonly kind: string;
  readonly screenId: RecordId;
  readonly parentId?: RecordId;
  readonly index: string;
  readonly transform?: Box;
};

const element = (ctx: CommandContext, x: string): El => ctx.store.get(x as RecordId) as unknown as El;

/** COMMAND_ARGS for `command`, with the argument `at` named in the diagnostic. */
function refuse(command: string, at: ReadonlyArray<string | number>, problem: string): Result<never, TxFailure> {
  return err({
    code: 'COMMAND_ARGS',
    message: `${command}: ${problem}`,
    diagnostics: [{ code: 'FLX_COMMAND_ARGS', severity: 'error', path: jsonPointer(['args', ...at]), message: problem }],
  });
}

/** The elements under `parentId` of `screenId` (the screen's top level when absent), in z-order. */
function siblings(ctx: CommandContext, screenId: RecordId, parentId: RecordId | undefined): El[] {
  const ids =
    parentId === undefined
      ? ctx.store.members('byScreen', screenId).filter((x) => element(ctx, x).parentId === undefined)
      : ctx.store.members('byParent', parentId);
  return ids
    .map((x) => element(ctx, x))
    .filter((e) => e.index !== undefined)
    .sort((a, b) => compareKeys(a.index, b.index));
}

/** `count` index keys in order between `low` and the next key above it in `taken` (open above when none), or why not. */
function keysAfter(low: string, taken: readonly string[], count: number): Result<string[], string> {
  const above = taken.find((k) => compareKeys(k, low) > 0) ?? null;
  const keys: string[] = [];
  let from: string = low;
  for (let i = 0; i < count; i += 1) {
    const key = keyBetween(from, above);
    if (!key.ok) return err(key.error.message);
    keys.push(key.value);
    from = key.value;
  }
  return ok(keys);
}

/** The group commands (FR-ARR-001). */
export const GROUP_COMMANDS: readonly AnyCommand[] = [
  defineCommand({
    id: 'element.group',
    title: title('element.group', 'Group'),
    // the new group takes the members' place, just above the topmost of them; its box is their bounds
    args: z.object({ ids: z.array(id).min(1), groupId: id, name: z.string().optional() }),
    run: (ctx, args) => {
      const bad =
        checkIds(
          ctx,
          'element.group',
          'element',
          args.ids.map((x, i) => [['ids', i], x] as const),
        ) ?? checkIds(ctx, 'element.group', 'new', [[['groupId'], args.groupId]]);
      if (bad) return bad;
      const members = args.ids.map((x) => element(ctx, x));
      const first = members[0] as El;
      if (new Set(args.ids).size !== args.ids.length) return refuse('element.group', ['ids'], 'an element is listed twice');
      if (members.some((m) => m.screenId !== first.screenId || m.parentId !== first.parentId))
        return refuse('element.group', ['ids'], 'the elements are not siblings (one screen, one parent)');
      const box = boundsOfPlacements(members.flatMap((m) => m.transform ?? []));
      if (box === undefined) return refuse('element.group', ['ids'], 'no element has a box to bound the group');
      const taken = siblings(ctx, first.screenId, first.parentId).map((e) => e.index);
      const top = members
        .map((m) => m.index)
        .sort(compareKeys)
        .at(-1) as string;
      const index = keysAfter(top, taken, 1);
      if (!index.ok) return refuse('element.group', ['ids'], index.error);
      const group = {
        id: args.groupId,
        type: 'element',
        kind: 'group',
        screenId: first.screenId,
        ...(first.parentId === undefined ? {} : { parentId: first.parentId }),
        index: index.value[0],
        ...(args.name === undefined ? {} : { name: args.name }),
        transform: { ...box, rot: 0 },
      };
      return write(ctx, 'element.group', (tx) => {
        tx.put(group as unknown as AnyRecord);
        for (const m of members) tx.patch(m.id, { parentId: args.groupId });
      });
    },
  }),
  defineCommand({
    id: 'element.ungroup',
    title: title('element.ungroup', 'Ungroup'),
    // the members move up one level into the group's place, in their order, and the group record goes
    args: z.object({ ids: z.array(id).min(1) }),
    run: (ctx, args) => {
      const bad = checkIds(
        ctx,
        'element.ungroup',
        'element',
        args.ids.map((x, i) => [['ids', i], x] as const),
      );
      if (bad) return bad;
      const groups = args.ids.map((x) => element(ctx, x));
      const notGroup = groups.findIndex((g) => g.kind !== 'group');
      if (notGroup >= 0) return refuse('element.ungroup', ['ids', notGroup], `"${args.ids[notGroup]}" is not a group`);
      const nested = groups.findIndex((g) => g.parentId !== undefined && args.ids.includes(g.parentId));
      if (nested >= 0) return refuse('element.ungroup', ['ids', nested], 'a group and one inside it cannot be ungrouped together');
      const plan: Array<{ readonly id: RecordId; readonly parentId: RecordId | undefined; readonly index: string }> = [];
      for (const g of groups) {
        const members = siblings(ctx, g.screenId, g.id);
        const taken = siblings(ctx, g.screenId, g.parentId).map((e) => e.index);
        const keys = keysAfter(g.index, taken, members.length);
        if (!keys.ok) return refuse('element.ungroup', ['ids'], keys.error);
        for (const [i, m] of members.entries()) plan.push({ id: m.id, parentId: g.parentId, index: keys.value[i] as string });
      }
      return write(ctx, 'element.ungroup', (tx) => {
        for (const p of plan) tx.patch(p.id, { parentId: p.parentId, index: p.index });
        for (const g of groups) tx.delete(g.id);
      });
    },
  }),
];
