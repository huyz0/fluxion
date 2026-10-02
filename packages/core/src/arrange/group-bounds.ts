// A group's box is the bounds of its members (FR-ARR-001, M8.4/M8.5): the integrity hook that keeps it so. Members
// keep their screen coordinates (grouping never moves them), so a member edited alone, added, removed or taken out
// of the group changes what the group's frame must be; this hook refits the groups a transaction touched, and the
// groups around them, deepest first, in the same transaction (one undo step, ADR-0014). A group's own record
// edited on its own is left as written.
import { elementBounds } from '@fluxion/geometry';
import type { AnyRecord, RecordId } from '@fluxion/schema';
import type { HookContext, IntegrityHook } from '../hook-types.js';

type Fields = { readonly parentId?: unknown; readonly kind?: unknown; readonly type?: unknown; readonly transform?: Placed };

const fields = (r: AnyRecord | undefined) => r as Fields | undefined;

/** The groups above the element records `changed`, each with its depth (the number of groups above it). */
function groupsAbove(context: HookContext, changed: readonly (AnyRecord | undefined)[]): Map<RecordId, number> {
  const out = new Map<RecordId, number>();
  const parentOf = (r: AnyRecord | undefined) => fields(r)?.parentId as RecordId | undefined;
  const isGroup = (id: RecordId) => fields(context.tx.get(id))?.kind === 'group';
  const start = new Set(changed.flatMap((r) => (fields(r)?.type === 'element' && parentOf(r) !== undefined ? [parentOf(r) as RecordId] : [])));
  for (const first of start) {
    for (let g: RecordId | undefined = first; g !== undefined && isGroup(g); g = parentOf(context.tx.get(g))) {
      if (!out.has(g)) out.set(g, 0);
    }
  }
  for (const g of out.keys()) {
    let depth = 0;
    for (let p = parentOf(context.tx.get(g)); p !== undefined && out.has(p); p = parentOf(context.tx.get(p))) depth += 1;
    out.set(g, depth);
  }
  return out;
}

/** A box with the fields a placement may have (rotation and flips as the element draws them). */
export type Placed = {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly rot?: number;
  readonly flipX?: boolean;
  readonly flipY?: boolean;
};

/**
 * The bounds of the drawn extents of `placements` (turns and flips included), or undefined when there are none. One
 * definition for the command that makes a group and the hook that keeps it (a loop, not a spread: any number of members).
 */
export function boundsOfPlacements(placements: readonly Placed[]): { x: number; y: number; w: number; h: number } | undefined {
  let [x1, y1, x2, y2] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const p of placements) {
    const b = elementBounds({ ...p, rot: p.rot ?? 0 });
    [x1, y1, x2, y2] = [Math.min(x1, b.x), Math.min(y1, b.y), Math.max(x2, b.x + b.w), Math.max(y2, b.y + b.h)];
  }
  return placements.length === 0 ? undefined : { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** The bounds of the boxed members of group `g` as `tx` sees them, or undefined when none has a box. */
function boundsOfMembers(context: HookContext, g: RecordId): { x: number; y: number; w: number; h: number } | undefined {
  return boundsOfPlacements(context.members('byParent', g).flatMap((m) => fields(context.tx.get(m))?.transform ?? []));
}

/**
 * Refit the groups above the elements this transaction changed to the bounds of their members: a group is
 * written only when its box differs, so a pass that finds nothing writes nothing (the fixed point).
 */
export const groupBoundsHook: IntegrityHook = (context) => {
  const changed = [...context.diff.puts.values()].flatMap((c) => [c.before, c.after]);
  const groups = groupsAbove(context, [...changed, ...context.deleted.values()]);
  // deepest first: a nested group's new box is seen by the group around it
  for (const [g] of [...groups].sort((a, b) => b[1] - a[1])) {
    const box = boundsOfMembers(context, g);
    const have = fields(context.tx.get(g))?.transform;
    if (box === undefined || have === undefined) continue;
    const same = have.x === box.x && have.y === box.y && have.w === box.w && have.h === box.h && (have.rot ?? 0) === 0 && !have.flipX && !have.flipY;
    if (!same) context.tx.patch(g, { transform: { ...box, rot: 0 } });
  }
};
