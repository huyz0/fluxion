// Align (FR-ARR-002, M8.6): bring the edges or centres of the selected elements to a reference, which is their own
// bounds, the shown screen or one of them, the key. Drawn extents decide (a turned shape by its world bounds), a
// group moves as one with its members, and the whole is one transaction. The vectors are pure (`alignDelta`);
// `element.align` reads the document and writes them.
import { elementBounds } from '@fluxion/geometry';
import { DEFAULT_SCREEN_SIZE, err, jsonPointer, type RecordId, type Result } from '@fluxion/schema';
import { z } from 'zod';
import { checkIds, id, title, write } from '../command-helpers.js';
import { type AnyCommand, type CommandContext, defineCommand } from '../commands.js';
import type { TxFailure } from '../transaction.js';
import { movesFor, outermost } from './translate.js';

/**
 * What aligns: the left or right edge or the horizontal centre, the top or bottom edge or the vertical middle.
 *
 * @public
 */
export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

type Box = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

/**
 * The shift that brings `box`'s edge or centre named by `mode` to the same line of `reference`, on the one axis the mode
 * is about.
 *
 * @public
 */
export function alignDelta(box: Box, mode: AlignMode, reference: Box): { readonly x: number; readonly y: number } {
  switch (mode) {
    case 'left':
      return { x: reference.x - box.x, y: 0 };
    case 'center':
      return { x: reference.x + reference.w / 2 - (box.x + box.w / 2), y: 0 };
    case 'right':
      return { x: reference.x + reference.w - (box.x + box.w), y: 0 };
    case 'top':
      return { x: 0, y: reference.y - box.y };
    case 'middle':
      return { x: 0, y: reference.y + reference.h / 2 - (box.y + box.h / 2) };
    default:
      return { x: 0, y: reference.y + reference.h - (box.y + box.h) };
  }
}

type El = { readonly screenId: RecordId; readonly transform?: Box & { readonly rot?: number; readonly flipX?: boolean; readonly flipY?: boolean } };

/** COMMAND_ARGS for `command`, naming the argument `at`. */
function refuse(command: string, at: ReadonlyArray<string | number>, problem: string): Result<never, TxFailure> {
  return err({
    code: 'COMMAND_ARGS',
    message: `${command}: ${problem}`,
    diagnostics: [{ code: 'FLX_COMMAND_ARGS', severity: 'error', path: jsonPointer(['args', ...at]), message: problem }],
  });
}

/** The drawn bounds of element `x`, or undefined when it has no box (a connector). */
export function drawnBounds(ctx: CommandContext, x: RecordId): Box | undefined {
  const t = (ctx.store.get(x) as unknown as El | undefined)?.transform;
  return t === undefined ? undefined : elementBounds({ ...t, rot: t.rot ?? 0 });
}

/** The union of `boxes`. */
export function unionOf(boxes: readonly Box[]): Box {
  let [x1, y1, x2, y2] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const b of boxes) [x1, y1, x2, y2] = [Math.min(x1, b.x), Math.min(y1, b.y), Math.max(x2, b.x + b.w), Math.max(y2, b.y + b.h)];
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

const toSchema = z.union([z.literal('selection'), z.literal('screen'), z.object({ key: id })]);

/** The align command (FR-ARR-002). */
export const ALIGN_COMMANDS: readonly AnyCommand[] = [
  defineCommand({
    id: 'element.align',
    title: title('element.align', 'Align'),
    // `to`: the selection's own bounds, the screen, or the `key` element (which stays where it is)
    args: z.object({ ids: z.array(id).min(1), mode: z.enum(['left', 'center', 'right', 'top', 'middle', 'bottom']), to: toSchema }),
    run: (ctx, args) => {
      const bad = checkIds(
        ctx,
        'element.align',
        'element',
        args.ids.map((x, i) => [['ids', i], x] as const),
      );
      if (bad) return bad;
      const movers = outermost(ctx, args.ids as RecordId[]).filter((x) => drawnBounds(ctx, x) !== undefined);
      if (movers.length === 0) return refuse('element.align', ['ids'], 'no element has a box to align');
      const boxes = new Map(movers.map((x) => [x, drawnBounds(ctx, x) as Box]));
      let reference: Box;
      if (args.to === 'selection') reference = unionOf([...boxes.values()]);
      else if (args.to === 'screen') {
        const screenId = (ctx.store.get(movers[0] as RecordId) as unknown as El).screenId;
        const screen = ctx.store.get(screenId) as unknown as { kind?: 'fixed' | 'infinite'; size?: { w: number; h: number } };
        if (movers.some((x) => (ctx.store.get(x) as unknown as El).screenId !== screenId))
          return refuse('element.align', ['ids'], 'the elements are on different screens');
        if (screen.kind === 'infinite') return refuse('element.align', ['to'], 'an infinite screen has no edges to align to');
        reference = { x: 0, y: 0, ...(screen.size ?? DEFAULT_SCREEN_SIZE) };
      } else {
        const key = boxes.get(args.to.key as RecordId);
        if (key === undefined) return refuse('element.align', ['to', 'key'], `"${args.to.key}" is not one of the elements aligned (or has no box)`);
        reference = key;
      }
      const deltas = new Map(movers.map((x) => [x, alignDelta(boxes.get(x) as Box, args.mode, reference)]));
      const moves = movesFor(ctx, deltas);
      return write(ctx, 'element.align', (tx) => {
        for (const m of moves) tx.patch(m.id, m.fields);
      });
    },
  }),
];
