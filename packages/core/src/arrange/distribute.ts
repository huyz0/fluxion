// Distribute (FR-ARR-003, M8.7): space the selected elements evenly along an axis, by equal gaps between their drawn
// bounds or equal distances between their centres, the outer two staying; or lay them out in order from the first with
// a fixed gap. Groups move as one with their members (translate.ts); the whole is one undo step.
import type { RecordId } from '@fluxion/schema';
import { z } from 'zod';
import { checkIds, id, title, write } from '../command-helpers.js';
import { type AnyCommand, defineCommand } from '../commands.js';
import { drawnBounds, refuse } from './align.js';
import { movesFor, outermost } from './translate.js';

type Box = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

/**
 * The axis a distribution runs along.
 *
 * @public
 */
export type DistributeAxis = 'horizontal' | 'vertical';

type Item = { readonly id: string; readonly box: Box };
type Pos = 'x' | 'y';
type Size = 'w' | 'h';

/** Starts that lay `sorted` out from the first, each `gap` after the one before. */
function fixedGap(sorted: readonly Item[], pos: Pos, size: Size, gap: number): number[] {
  const starts: number[] = [];
  let at = (sorted[0] as Item).box[pos];
  for (const item of sorted) {
    starts.push(at);
    at += item.box[size] + gap;
  }
  return starts;
}

/** Starts that make the gaps between neighbours equal, the first and the last staying. */
function evenGaps(sorted: readonly Item[], pos: Pos, size: Size): number[] {
  const [first, last] = [sorted[0] as Item, sorted[sorted.length - 1] as Item];
  const total = last.box[pos] + last.box[size] - first.box[pos];
  const free = (total - sorted.reduce((sum, item) => sum + item.box[size], 0)) / (sorted.length - 1);
  return fixedGap(sorted, pos, size, free);
}

/** Starts that make the distances between neighbouring centres equal, the first and the last staying. */
function evenCentres(sorted: readonly Item[], pos: Pos, size: Size): number[] {
  const [first, last] = [sorted[0] as Item, sorted[sorted.length - 1] as Item];
  const [c0, c1] = [first.box[pos] + first.box[size] / 2, last.box[pos] + last.box[size] / 2];
  return sorted.map((item, i) => c0 + ((c1 - c0) * i) / (sorted.length - 1) - item.box[size] / 2);
}

/**
 * The shift along `axis` that puts each of `items` where an even distribution has it, keyed by id, or undefined when
 * there is nothing to space (fewer than three without a `gap`, fewer than two with). `by: 'gaps'` makes the gaps
 * between neighbours equal, the outer two staying; `by: 'centers'` the distances between centres. With a `gap`, the
 * first stays and the others follow in order, each `gap` after the one before.
 *
 * @public
 */
export function distributeDeltas(
  items: ReadonlyArray<{ readonly id: string; readonly box: Box }>,
  axis: DistributeAxis,
  by: 'gaps' | 'centers',
  gap?: number,
): Map<string, number> | undefined {
  if (items.length < (gap === undefined ? 3 : 2)) return undefined;
  const [pos, size] = axis === 'horizontal' ? (['x', 'w'] as const) : (['y', 'h'] as const);
  const sorted = [...items].sort((a, b) => a.box[pos] - b.box[pos] || a.box[size] - b.box[size]);
  const starts = gap === undefined ? (by === 'gaps' ? evenGaps(sorted, pos, size) : evenCentres(sorted, pos, size)) : fixedGap(sorted, pos, size, gap);
  return new Map(sorted.map((item, i) => [item.id, (starts[i] as number) - item.box[pos]]));
}

/** The distribute command (FR-ARR-003). */
export const DISTRIBUTE_COMMANDS: readonly AnyCommand[] = [
  defineCommand({
    id: 'element.distribute',
    title: title('element.distribute', 'Distribute'),
    args: z.object({ ids: z.array(id).min(1), axis: z.enum(['horizontal', 'vertical']), by: z.enum(['gaps', 'centers']), gap: z.number().finite().optional() }),
    run: (ctx, args) => {
      const bad = checkIds(
        ctx,
        'element.distribute',
        'element',
        args.ids.map((x, i) => [['ids', i], x] as const),
      );
      if (bad) return bad;
      const ordered = outermost(ctx, args.ids as RecordId[]);
      const screens = new Set(ordered.map((x) => (ctx.store.get(x) as unknown as { screenId?: unknown }).screenId));
      if (screens.size > 1) return refuse('element.distribute', ['ids'], 'the elements are on different screens');
      const movers = ordered.flatMap((x) => {
        const box = drawnBounds(ctx, x);
        return box === undefined ? [] : [{ id: x as string, box }];
      });
      const shifts = distributeDeltas(movers, args.axis, args.by, args.gap);
      if (shifts === undefined)
        return refuse('element.distribute', ['ids'], `${args.gap === undefined ? 'three' : 'two'} elements with boxes are needed to space`);
      const deltas = new Map([...shifts].map(([x, d]) => [x as RecordId, args.axis === 'horizontal' ? { x: d, y: 0 } : { x: 0, y: d }]));
      const moves = movesFor(ctx, deltas);
      return write(ctx, 'element.distribute', (tx) => {
        for (const m of moves) tx.patch(m.id, m.fields);
      });
    },
  }),
];
