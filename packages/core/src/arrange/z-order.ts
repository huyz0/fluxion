// Z-order (FR-ARR-004, M8.8): bring elements to the front, forward one place, backward one place or to the back among
// their siblings. The order is the fractional index (02 §1), so only the elements that move get a new key: one
// record for one element, never a renumbering of the siblings. A group moves by its own key, its members' keys stay.
import { compareKeys, keyBetween, type RecordId } from '@fluxion/schema';
import { z } from 'zod';
import { checkIds, id, refuse, title, write } from '../command-helpers.js';
import { type AnyCommand, type CommandContext, defineCommand } from '../commands.js';
import { outermost } from './placed.js';
import { type El, element, siblings } from './siblings.js';

/**
 * Where an element goes among its siblings: the very top, one place up, one place down, the very bottom.
 *
 * @public
 */
export type ZOrder = 'front' | 'forward' | 'backward' | 'back';

/**
 * `list` (back to front) with the `picked` members moved by `to`, as a block: the picked and the others each keep
 * their own order. `forward` and `backward` move each picked one place past a neighbour that is not picked, so picked
 * neighbours stay together and the one at the end stops there.
 *
 * @public
 */
export function zOrdered<T>(list: readonly T[], picked: ReadonlySet<T>, to: ZOrder): T[] {
  if (to === 'front' || to === 'back') {
    const chosen = list.filter((x) => picked.has(x));
    const rest = list.filter((x) => !picked.has(x));
    return to === 'front' ? [...rest, ...chosen] : [...chosen, ...rest];
  }
  return to === 'forward' ? stepped(list, picked, 1) : stepped(list, picked, -1);
}

/** Each picked element one place along `direction` (1: up, -1: down), past a neighbour that is not picked; the end element stops. */
function stepped<T>(list: readonly T[], picked: ReadonlySet<T>, direction: 1 | -1): T[] {
  const out = [...list];
  // the elements nearest the end it moves towards go first, so a picked block moves together
  const order = out.map((_, i) => i);
  if (direction === 1) order.reverse();
  for (const i of order) {
    const j = i + direction;
    if (j < 0 || j >= out.length || !picked.has(out[i] as T) || picked.has(out[j] as T)) continue;
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** The new index of each picked element of `list` after `to`, or why none exists. Others keep theirs: only the picked are written. */
function newKeys(
  list: ReadonlyArray<{ readonly id: RecordId; readonly index: string }>,
  picked: ReadonlySet<RecordId>,
  to: ZOrder,
): { readonly keys: Map<RecordId, string> } | { readonly problem: string } {
  const order = zOrdered(
    list.map((e) => e.id),
    picked,
    to,
  );
  const fixed = new Map(list.filter((e) => !picked.has(e.id)).map((e) => [e.id, e.index]));
  const keys = new Map<RecordId, string>();
  let lower: string | null = null;
  for (const [i, x] of order.entries()) {
    if (!picked.has(x)) {
      lower = fixed.get(x) as string;
      continue;
    }
    // the next element after it that keeps its key bounds it from above
    const upper = order.slice(i + 1).find((y) => !picked.has(y));
    const key = keyBetween(lower, upper === undefined ? null : (fixed.get(upper) as string));
    if (!key.ok) return { problem: key.error.message };
    // an element already between its neighbours keeps the key it has
    const old = list.find((e) => e.id === x)?.index as string;
    const keepOld = (lower === null || compareKeys(old, lower) > 0) && (upper === undefined || compareKeys(old, fixed.get(upper) as string) < 0);
    keys.set(x, keepOld ? old : key.value);
    lower = keys.get(x) as string;
  }
  return { keys };
}

/**
 * The index that puts `moved` right in front of its sibling `after` (at the back when absent), or why none exists:
 * `after` must be another element under the same parent of the same screen. Only `moved`'s key is new (FR-ARR-008).
 */
function indexInFront(ctx: CommandContext, moved: El, after: string | undefined): { readonly key: string } | { readonly problem: string } {
  const list = siblings(ctx, moved.screenId, moved.parentId).filter((e) => e.id !== moved.id);
  const at = after === undefined ? -1 : list.findIndex((e) => e.id === after);
  if (after !== undefined && at < 0) return { problem: `"${after}" is not a sibling of "${moved.id}"` };
  const [lower, upper] = [list[at]?.index ?? null, list[at + 1]?.index ?? null];
  // an element already in that place keeps its key: nothing is written
  if ((lower === null || compareKeys(moved.index, lower) > 0) && (upper === null || compareKeys(moved.index, upper) < 0)) return { key: moved.index };
  const key = keyBetween(lower, upper);
  return key.ok ? { key: key.value } : { problem: key.error.message };
}

/** The z-order commands (FR-ARR-004, FR-ARR-008). */
export const Z_ORDER_COMMANDS: readonly AnyCommand[] = [
  defineCommand({
    id: 'element.zOrder',
    title: title('element.zOrder', 'Arrange'),
    args: z.object({ ids: z.array(id).min(1), to: z.enum(['front', 'forward', 'backward', 'back']) }),
    run: (ctx, args) => {
      const bad = checkIds(
        ctx,
        'element.zOrder',
        'element',
        args.ids.map((x, i) => [['ids', i], x] as const),
      );
      if (bad) return bad;
      // each sibling list on its own: the picked elements of one parent of one screen
      const lists = new Map<string, Set<RecordId>>();
      for (const x of outermost(ctx.store, args.ids as RecordId[])) {
        const e = element(ctx, x);
        const key = `${e.screenId}|${e.parentId ?? ''}`;
        lists.set(key, (lists.get(key) ?? new Set()).add(x));
      }
      const writes: Array<readonly [RecordId, string]> = [];
      for (const picked of lists.values()) {
        const first = element(ctx, [...picked][0] as string);
        const list = siblings(ctx, first.screenId, first.parentId);
        const result = newKeys(list, picked, args.to);
        if ('problem' in result) return refuse('element.zOrder', ['ids'], result.problem);
        for (const [x, key] of result.keys) if (element(ctx, x).index !== key) writes.push([x, key]);
      }
      return write(ctx, 'element.zOrder', (tx) => {
        for (const [x, key] of writes) tx.patch(x, { index: key });
      });
    },
  }),
  defineCommand({
    id: 'element.reorder',
    title: title('element.reorder', 'Move layer'),
    // `after`: the sibling it is drawn right in front of; absent → the back. The layers panel's drag (FR-ARR-008).
    args: z.object({ id, after: id.optional() }),
    run: (ctx, args) => {
      const refs: Array<readonly [ReadonlyArray<string | number>, string]> = [[['id'], args.id]];
      if (args.after !== undefined) refs.push([['after'], args.after]);
      const bad = checkIds(ctx, 'element.reorder', 'element', refs);
      if (bad) return bad;
      if (args.after === args.id) return refuse('element.reorder', ['after'], 'an element cannot be placed in front of itself');
      const moved = element(ctx, args.id);
      const placed = indexInFront(ctx, moved, args.after);
      if ('problem' in placed) return refuse('element.reorder', ['after'], placed.problem);
      return write(ctx, 'element.reorder', (tx) => {
        if (placed.key !== moved.index) tx.patch(moved.id, { index: placed.key });
      });
    },
  }),
];
