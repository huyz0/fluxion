// Match size and the format painter (FR-ARR-007, M19.12). Match size gives each element the width, the height or both of a key
// element's box, its top-left corner staying where it is; a group's members scale with it about that corner (a group's box is
// its members' bounds), a frame changes its box alone (ADR-0052), and a listed group that holds the key is left out, so the key
// stays as it is (M19 cp2 F6). The format painter copies one element's `style` to others as
// it is written, theme tokens included, and nothing else: `semantic`, text, geometry and the rest stay the target's own. A group
// takes the style on each of its members; a group as the source is refused, having no style of its own. Each is one transaction, one undo step.
import type { RecordId } from '@fluxion/schema';
import { z } from 'zod';
import { checkIds, id, refuse, title, write } from '../command-helpers.js';
import { type AnyCommand, type CommandContext, defineCommand } from '../commands.js';
import { hasLock, lockedWithin } from './locks.js';
import { carried, centreOf, outermost, type Placed, type PlacedFields, rad, type Vec, withMembers } from './placed.js';

type El = PlacedFields & { readonly kind?: unknown; readonly style?: unknown };

const get = (ctx: CommandContext, x: RecordId): El | undefined => ctx.store.get(x) as unknown as El | undefined;
/** Whether `x` is a group: drawn by its members, which its box bounds and its size and style reach. */
const isGroup = (ctx: CommandContext, x: RecordId): boolean => get(ctx, x)?.kind === 'group';

/**
 * Every placed field of `r` carried from the group box `before` to `after` (same corner and turn, new size), as the editor's group
 * resize carries them (editor move.ts `reframedBox`): a point keeps its place in the box, scaled along the box's axes; a member's box
 * keeps its centre's place and is stretched along its own axes by the scales taken into them (exact for turns by quarters).
 */
function scaled(r: El, before: Placed, after: Placed): Record<string, unknown> {
  const [sx, sy] = [before.w === 0 ? 1 : after.w / before.w, before.h === 0 ? 1 : after.h / before.h];
  const phi = rad(Number(before['rot'] ?? 0));
  const [cos, sin] = [Math.cos(phi), Math.sin(phi)];
  const [cb, ca] = [centreOf(before), centreOf(after)];
  const at = (p: Vec): Vec => {
    // into the box's own axes about its centre, scaled, and back about the new centre
    const [dx, dy] = [p.x - cb.x, p.y - cb.y];
    const [lx, ly] = [(dx * cos + dy * sin) * sx, (-dx * sin + dy * cos) * sy];
    return { x: ca.x + lx * cos - ly * sin, y: ca.y + lx * sin + ly * cos };
  };
  return carried(r, at, (t, c) => {
    const turn = rad(Number(t['rot'] ?? 0)) - phi;
    const [w, h] = [t.w * Math.hypot(Math.cos(turn) * sx, Math.sin(turn) * sy), t.h * Math.hypot(Math.sin(turn) * sx, Math.cos(turn) * sy)];
    return { ...t, x: c.x - w / 2, y: c.y - h / 2, w, h };
  });
}

/** The patches that size `x` to `w` × `h` from its top-left: a group's members scaled with it; a frame (or any other box) itself. */
function sizedTo(ctx: CommandContext, x: RecordId, w: number, h: number): Array<{ id: RecordId; fields: Record<string, unknown> }> {
  const t = get(ctx, x)?.transform as Placed;
  if (t.w === w && t.h === h) return [];
  if (!isGroup(ctx, x)) return [{ id: x, fields: { transform: { ...t, w, h }, placement: 'pinned' } }];
  // a group's box is its members' drawn bounds (the group-bounds hook refits it): its members are carried to the box of the new size
  const after = { ...t, w, h };
  return withMembers(ctx.store, x).flatMap((m) => {
    const fields = scaled(get(ctx, m) as El, t, after);
    // every box sized by hand is pinned, as a move pins it (ADR-0031): layout keeps the size
    return Object.keys(fields).length === 0 ? [] : [{ id: m, fields: 'transform' in fields ? { ...fields, placement: 'pinned' } : fields }];
  });
}

/**
 * The size `t` takes from the key box `key` by `mode`; with `aspect` its ratio stays, the matched side deciding (`both`: the width).
 */
function matched(t: Placed, key: Placed, mode: 'width' | 'height' | 'both', aspect: boolean): { readonly w: number; readonly h: number } {
  const to = { w: mode === 'height' ? t.w : key.w, h: mode === 'width' ? t.h : key.h };
  if (!aspect || t.w === 0 || t.h === 0) return to;
  return mode === 'height' ? { w: (t.w * to.h) / t.h, h: to.h } : { w: to.w, h: (t.h * to.w) / t.w };
}

/** `x` when it has a style of its own to take, or each of a group's members that does, all the way down. */
function painted(ctx: CommandContext, x: RecordId): RecordId[] {
  return isGroup(ctx, x) ? ctx.store.members('byParent', x).flatMap((m) => painted(ctx, m)) : [x];
}

const elements = (ctx: CommandContext, command: string, at: string, ids: readonly string[]) =>
  checkIds(
    ctx,
    command,
    'element',
    ids.map((x, i) => [[at, i], x] as const),
  );

/** The match-size and format-painter commands (FR-ARR-007). */
export const MATCH_COMMANDS: readonly AnyCommand[] = [
  defineCommand({
    id: 'element.matchSize',
    title: title('element.matchSize', 'Match size'),
    // `key`: the element whose size the others take (it stays as it is; it may be listed in `ids` too)
    args: z.object({ ids: z.array(id).min(1), key: id, mode: z.enum(['width', 'height', 'both']) }),
    run: (ctx, args) => {
      const bad = elements(ctx, 'element.matchSize', 'ids', args.ids) ?? checkIds(ctx, 'element.matchSize', 'element', [[['key'], args.key]]);
      if (bad) return bad;
      const key = get(ctx, args.key as RecordId) as El;
      if (key.transform === undefined) return refuse('element.matchSize', ['key'], `"${args.key}" has no box to match`);
      // the key stays as it is: a listed group that holds it is left out, or sizing it would scale the key with it (cp2 F6); a frame
      // holding it is sized, as a frame's resize leaves its members alone
      const holdsKey = (x: RecordId) => x === args.key || (isGroup(ctx, x) && withMembers(ctx.store, x).includes(args.key as RecordId));
      const sized = outermost(ctx.store, args.ids as RecordId[]).filter((x) => !holdsKey(x) && get(ctx, x)?.transform !== undefined);
      if (sized.length === 0) return refuse('element.matchSize', ['ids'], 'no other element has a box to size');
      // a size lock skips the element; an aspect lock keeps its ratio (FR-SHP-008, M19 cp2 F3)
      const patches = sized
        .filter((x) => !hasLock(ctx.store, x, 'size'))
        .flatMap((x) => {
          const t = get(ctx, x)?.transform as Placed;
          const to = matched(t, key.transform as Placed, args.mode, hasLock(ctx.store, x, 'aspect'));
          return sizedTo(ctx, x, to.w, to.h);
        });
      return write(ctx, 'element.matchSize', (tx) => {
        for (const p of patches) tx.patch(p.id, p.fields);
      });
    },
  }),
  defineCommand({
    id: 'element.pasteStyle',
    title: title('element.pasteStyle', 'Paste style'),
    // `from`: the element whose style is copied; `ids`: the elements that take it
    args: z.object({ from: id, ids: z.array(id).min(1) }),
    run: (ctx, args) => {
      const bad = elements(ctx, 'element.pasteStyle', 'ids', args.ids) ?? checkIds(ctx, 'element.pasteStyle', 'element', [[['from'], args.from]]);
      if (bad) return bad;
      // a group has no style of its own to give (its members draw it): painting from it would clear the targets' styles (cp2 F6)
      if (isGroup(ctx, args.from as RecordId)) return refuse('element.pasteStyle', ['from'], `"${args.from}" is a group, which has no style to copy`);
      const from = get(ctx, args.from as RecordId) as El;
      // an element with an edit lock keeps its style (FR-SHP-008), and so do the members of a group that holds one, at any depth
      const listed = outermost(ctx.store, args.ids as RecordId[]).filter((x) => !hasLock(ctx.store, x, 'edit'));
      const targets = [...new Set(listed.flatMap((x) => painted(ctx, x)))].filter((x) => x !== args.from && !lockedWithin(ctx.store, x, 'edit'));
      if (targets.length === 0) return refuse('element.pasteStyle', ['ids'], 'no element to take the style');
      return write(ctx, 'element.pasteStyle', (tx) => {
        // the style as written, theme tokens and all; none when the source has none
        for (const x of targets) tx.patch(x, { style: from.style === undefined ? undefined : from.style });
      });
    },
  }),
];
