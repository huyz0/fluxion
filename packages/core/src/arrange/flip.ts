// Flip (FR-SHP-009, M19.16): mirror elements horizontally or vertically about their own centres. A shape's `flipX`/`flipY` mirrors its
// drawing and its anchors (they are placed through the element's matrix), so a bound connector follows; a group's or a frame's members
// are mirrored with it (`elementFlipped`). One transaction, one undo step; flipping twice restores the element.
//
// Locks (FR-SHP-008, ADR-0054, M19 cp3 F4): a flip reads no lock. The element flipped keeps its place and its turn (2φ − φ = φ), so a
// position or rotation lock on it holds; a member goes with its flipped group or frame whatever it holds, as a locked member goes
// with its group's move, and a rotation-locked member's turn changes to the mirrored one (2φ − θ): keeping θ would draw it
// unmirrored inside a mirrored group.
import type { RecordId } from '@fluxion/schema';
import { z } from 'zod';
import { checkIds, id, refuse, title, write } from '../command-helpers.js';
import { type AnyCommand, defineCommand } from '../commands.js';
import type { ReadView } from '../store.js';
import type { FrameUpdate } from './frames.js';
import { below, carried, centreOf, outermost, type PlacedFields, rad, type Vec } from './placed.js';

const turnOf = (deg: number): number => ((deg % 360) + 360) % 360;
const placedOf = (view: ReadView, id: RecordId) => view.get(id) as (PlacedFields & { readonly type?: unknown }) | undefined;

/**
 * The updates that flip element `id` with what is below it (FR-SHP-009, ADR-0052): horizontally (`'x'`) each one's centre is mirrored
 * across the element's vertical centre line (turned with it, at `φ`), its `flipX` toggled and its `rot` θ mapped to `2φ − θ`;
 * vertically (`'y'`) the same across the horizontal centre line with `flipY`. The element itself keeps its place and turn
 * (2φ − φ = φ); a group's or a frame's members are carried, locked ones too (the lock rule above). None when `id` has no box.
 * `element.flip` runs it; a frame's turn is the editor's rotate handle, which carries members as it carries a group's (one path
 * each, M19 cp2 F1, M19.16 r1 F1).
 *
 * @public
 */
export function elementFlipped(view: ReadView, id: RecordId, axis: 'x' | 'y'): FrameUpdate[] {
  const t = placedOf(view, id)?.transform;
  if (t === undefined) return [];
  const c = centreOf(t);
  const phi = t.rot ?? 0;
  // the mirror line through the centre: the element's own y axis for a horizontal flip, its x axis for a vertical one
  const line = rad(axis === 'x' ? phi + 90 : phi);
  // a quarter turn's cosine is 6e-17, not 0: exact axes keep an unturned flip free of float noise
  const exact = (v: number): number => (Math.abs(v) < 1e-12 ? 0 : v);
  const u = { x: exact(Math.cos(line)), y: exact(Math.sin(line)) };
  const at = (p: Vec): Vec => {
    const d = { x: p.x - c.x, y: p.y - c.y };
    const along = d.x * u.x + d.y * u.y;
    return { x: c.x + 2 * along * u.x - d.x, y: c.y + 2 * along * u.y - d.y };
  };
  const flip = axis === 'x' ? 'flipX' : 'flipY';
  return [id, ...below(view, id)].flatMap((x) => {
    const r = placedOf(view, x);
    const fields =
      r?.type === 'element'
        ? carried(r, at, (b, m) => ({ ...b, x: m.x - b.w / 2, y: m.y - b.h / 2, rot: turnOf(2 * phi - (b.rot ?? 0)), [flip]: !b[flip] }))
        : {};
    return Object.keys(fields).length === 0 ? [] : [{ id: x, fields }];
  });
}

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
      const updates = outermost(ctx.store, args.ids as RecordId[]).flatMap((x) => elementFlipped(ctx.store, x, args.axis));
      if (updates.length === 0) return refuse('element.flip', ['ids'], 'no element has a box to flip');
      return write(ctx, 'element.flip', (tx) => {
        for (const u of updates) tx.patch(u.id, u.fields);
      });
    },
  }),
];
