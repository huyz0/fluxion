// Flip (FR-SHP-009, M19.16): mirror elements horizontally or vertically about their own centres. A shape's `flipX`/`flipY` mirrors its
// drawing and its anchors (they are placed through the element's matrix), so a bound connector follows; a group's or a frame's members
// are mirrored with it (`elementFlipped`). One transaction, one undo step; flipping twice restores the element.
import type { RecordId } from '@fluxion/schema';
import { z } from 'zod';
import { checkIds, id, refuse, title, write } from '../command-helpers.js';
import { type AnyCommand, defineCommand } from '../commands.js';
import { elementFlipped } from './frames.js';
import { outermost } from './translate.js';

/** The flip command (FR-SHP-009). */
export const FLIP_COMMANDS: readonly AnyCommand[] = [
  defineCommand({
    id: 'element.flip',
    title: title('element.flip', 'Flip'),
    // `axis`: 'x' mirrors left and right (flipX), 'y' top and bottom (flipY); each element about its own centre
    args: z.object({ ids: z.array(id).min(1), axis: z.enum(['x', 'y']) }),
    run: (ctx, args) => {
      const bad = checkIds(
        ctx,
        'element.flip',
        'element',
        args.ids.map((x, i) => [['ids', i], x] as const),
      );
      if (bad) return bad;
      const updates = outermost(ctx, args.ids as RecordId[]).flatMap((x) => elementFlipped(ctx.store, x, args.axis));
      if (updates.length === 0) return refuse('element.flip', ['ids'], 'no element has a box to flip');
      return write(ctx, 'element.flip', (tx) => {
        for (const u of updates) tx.patch(u.id, u.fields);
      });
    },
  }),
];
