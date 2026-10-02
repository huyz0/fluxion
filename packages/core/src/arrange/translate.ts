// Moving elements by a vector in a command (M8.6, M8.7): the fields that put one record `d` away, and the elements a
// move of some of them takes along (their members, all the way down: members keep screen coordinates). The editor's
// own move (editor/src/move.ts) does the same for a drag; arranging commands do it in core, undoably in one step.
import type { RecordId } from '@fluxion/schema';
import type { CommandContext } from '../commands.js';

type Vec = { readonly x: number; readonly y: number };
type Moving = {
  readonly type?: unknown;
  readonly parentId?: RecordId;
  readonly transform?: Vec & { readonly [field: string]: unknown };
  readonly freeSource?: Vec;
  readonly freeTarget?: Vec;
  readonly route?: { readonly waypoints?: readonly Vec[] } & { readonly [field: string]: unknown };
};

const shift = (p: Vec, d: Vec): Vec => ({ x: p.x + d.x, y: p.y + d.y });

/** The fields that put `record` `d` away from where it is; empty when it has nothing placed (a bound connector follows its ends). */
export function translateFields(record: Moving, d: Vec): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (record.transform) fields['transform'] = { ...record.transform, ...shift(record.transform, d) };
  if (record.freeSource) fields['freeSource'] = shift(record.freeSource, d);
  if (record.freeTarget) fields['freeTarget'] = shift(record.freeTarget, d);
  if (record.route?.waypoints) fields['route'] = { ...record.route, waypoints: record.route.waypoints.map((w) => shift(w, d)) };
  return fields;
}

/** `id` and its members, all the way down, in order. */
export function withMembers(ctx: CommandContext, id: RecordId): RecordId[] {
  return [id, ...ctx.store.members('byParent', id).flatMap((m) => withMembers(ctx, m))];
}

/** Of `ids`, those with none of the others above them (an element whose group is also listed moves with the group). */
export function outermost(ctx: CommandContext, ids: readonly RecordId[]): RecordId[] {
  const listed = new Set(ids);
  const above = (id: RecordId) => {
    for (let p = (ctx.store.get(id) as Moving | undefined)?.parentId; p !== undefined; p = (ctx.store.get(p) as Moving | undefined)?.parentId)
      if (listed.has(p)) return true;
    return false;
  };
  return ids.filter((id) => !above(id));
}

/** The moves that put each of `deltas` (element → vector) and its members away: one patch per record that has something to move. */
export function movesFor(ctx: CommandContext, deltas: ReadonlyMap<RecordId, Vec>): Array<{ readonly id: RecordId; readonly fields: Record<string, unknown> }> {
  const out: Array<{ id: RecordId; fields: Record<string, unknown> }> = [];
  for (const [id, d] of deltas) {
    if (d.x === 0 && d.y === 0) continue;
    for (const member of withMembers(ctx, id)) {
      const fields = translateFields(ctx.store.get(member) as Moving, d);
      if (Object.keys(fields).length > 0) out.push({ id: member, fields });
    }
  }
  return out;
}
