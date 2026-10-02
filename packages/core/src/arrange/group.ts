// Group and ungroup (FR-ARR-001, M8.4). A group is a container element whose box is the bounds of its
// members; members keep their screen coordinates (the render side undoes the container's placement, 04 §2),
// so grouping and ungrouping change only `parentId`, the container record and the sibling order: no
// member's box moves and no binding is touched, connectors stay attached.
import { type AnyRecord, compareKeys, type RecordId } from '@fluxion/schema';
import { z } from 'zod';
import { checkIds, id, refuse, title, write } from '../command-helpers.js';
import { type AnyCommand, defineCommand } from '../commands.js';
import { boundsOfPlacements } from './group-bounds.js';
import { type El, element, keysAfter, siblings } from './siblings.js';

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
