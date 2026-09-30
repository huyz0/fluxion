// Moving and duplicating a selection (FR-EDT-005): what moves with it (its members, all the way down,
// since members are placed in screen coordinates; a connector's free ends and waypoints), each moved
// record's fields from where it started, and copies of it for an alt-drag. Pure: the select tool turns
// these into element.updateMany and element.createMany commands.
import type { ReadView } from '@fluxion/core';
import type { Vec2 } from '@fluxion/geometry';
import { type AnyRecord, keyBetween, type RecordId } from '@fluxion/schema';
import { type Box2, carry } from './transform.js';

/**
 * A moved record's place as it started: its box, or a connector's free ends and waypoints.
 *
 * @public
 */
export type Start = {
  /** The element. */
  readonly id: RecordId;
  /** Its transform, when it has one. */
  readonly transform?: { readonly x: number; readonly y: number } & { readonly [field: string]: unknown };
  /** A connector's free source, free target and route, when it has them. */
  readonly freeSource?: Vec2;
  readonly freeTarget?: Vec2;
  readonly route?: { readonly waypoints?: readonly Vec2[] } & { readonly [field: string]: unknown };
};

/** `id` and its members, all the way down, in order. */
function withMembers(view: ReadView, id: RecordId): RecordId[] {
  return [id, ...view.members('byParent', id).flatMap((m) => withMembers(view, m))];
}

/**
 * Where the elements `ids` and their members start, each once: what a move of them moves.
 *
 * @public
 */
export function starts(view: ReadView, ids: readonly RecordId[]): Start[] {
  const all = [...new Set(ids.flatMap((id) => withMembers(view, id)))];
  return all.flatMap((id) => {
    const r = view.get(id) as (AnyRecord & Omit<Start, 'id'>) | undefined;
    if (r?.type !== 'element') return [];
    const { transform, freeSource, freeTarget, route } = r;
    return [{ id, ...(transform && { transform }), ...(freeSource && { freeSource }), ...(freeTarget && { freeTarget }), ...(route && { route }) }];
  });
}

const shift = (p: Vec2, d: Vec2): Vec2 => ({ x: p.x + d.x, y: p.y + d.y });

/**
 * The fields that put each record of `from` `d` away from where it started (element.updateMany's
 * updates); a record with nothing placed (a bound connector) is left to follow its ends.
 *
 * @public
 */
export function moved(from: readonly Start[], d: Vec2): { readonly id: RecordId; readonly fields: Record<string, unknown> }[] {
  return from.flatMap((s) => {
    const fields: Record<string, unknown> = {};
    if (s.transform) fields['transform'] = { ...s.transform, ...shift(s.transform, d) };
    if (s.freeSource) fields['freeSource'] = shift(s.freeSource, d);
    if (s.freeTarget) fields['freeTarget'] = shift(s.freeTarget, d);
    if (s.route?.waypoints) fields['route'] = { ...s.route, waypoints: s.route.waypoints.map((w) => shift(w, d)) };
    return Object.keys(fields).length === 0 ? [] : [{ id: s.id, fields }];
  });
}

/**
 * The fields that carry each record of `from` from the frame `before` to the frame `after` (a resize
 * or rotation of the selection): a box's centre carried, its size scaled, its turn turned; a free
 * connector's ends and waypoints carried.
 *
 * @public
 */
export function reframed(from: readonly Start[], before: Box2, after: Box2): { readonly id: RecordId; readonly fields: Record<string, unknown> }[] {
  const at = (p: Vec2) => carry(before, after, p);
  return from.flatMap((s) => {
    const fields: Record<string, unknown> = {};
    if (s.transform) fields['transform'] = reframedBox(s.transform as Placed & Record<string, unknown>, before, after);
    if (s.freeSource) fields['freeSource'] = at(s.freeSource);
    if (s.freeTarget) fields['freeTarget'] = at(s.freeTarget);
    if (s.route?.waypoints) fields['route'] = { ...s.route, waypoints: s.route.waypoints.map(at) };
    return Object.keys(fields).length === 0 ? [] : [{ id: s.id, fields }];
  });
}

type Placed = { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly rot?: number };

/**
 * The box `t` carried from the frame `before` to `after`: its centre carried, its turn turned, its
 * size scaled along its own axes, each taken into the frame's and stretched by the frame's scales
 * (exact for turns by quarters against the frame, M6.15 review F1).
 */
function reframedBox(t: Placed & Record<string, unknown>, before: Box2, after: Box2): Record<string, unknown> {
  const sx = before.w === 0 ? 1 : after.w / before.w;
  const sy = before.h === 0 ? 1 : after.h / before.h;
  const r = (((t.rot ?? 0) - before.rot) * Math.PI) / 180;
  const w = t.w * Math.hypot(Math.cos(r) * sx, Math.sin(r) * sy);
  const h = t.h * Math.hypot(Math.sin(r) * sx, Math.cos(r) * sy);
  const centre = carry(before, after, { x: t.x + t.w / 2, y: t.y + t.h / 2 });
  const rot = ((((t.rot ?? 0) + after.rot - before.rot) % 360) + 360) % 360;
  return { ...t, x: centre.x - w / 2, y: centre.y - h / 2, w, h, rot };
}

/** The first of the sorted `indexes` after `index`, if any (a binary search). */
function nextIndex(indexes: readonly string[], index: string): string | null {
  let lo = 0;
  let hi = indexes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    // tzap disable next-line EqualityOperator: the original's own index is among them; either bound skips it
    if ((indexes[mid] as string) <= index) lo = mid + 1;
    else hi = mid;
  }
  return indexes[lo] ?? null;
}

/** The sorted sibling indexes of the elements in `parent` (a group or frame), or at the root of `screen`. */
function siblingIndexes(view: ReadView, screen: RecordId, parent: RecordId | undefined): string[] {
  const ids =
    parent === undefined
      ? view.members('byScreen', screen).filter((s) => (view.get(s) as { parentId?: unknown }).parentId === undefined)
      : view.members('byParent', parent);
  return ids.map((id) => String((view.get(id) as { index?: unknown }).index)).sort();
}

/** Whether record `r` is a connector bound at an end (its copy would need its bindings copied too). */
const bound = (view: ReadView, id: RecordId) =>
  view.members('bindingsByElement', id).some((b) => (view.get(b) as { connectorId?: unknown }).connectorId === id);

/** `r` without its semantic slug, which names one element only (a copy is unnamed until renamed). */
function withoutSlug(r: { readonly [field: string]: unknown }): { readonly [field: string]: unknown } {
  const semantic = r['semantic'] as { readonly slug?: unknown } | undefined;
  if (semantic?.slug === undefined) return r;
  const { slug: _, ...rest } = semantic;
  const { semantic: __, ...copy } = r;
  return Object.keys(rest).length === 0 ? copy : { ...copy, semantic: rest };
}

/**
 * Copies of the elements `ids` and their members, each with a fresh id from `newId`, members under
 * their copied parent, each just in front of its original, without the semantic slug that names
 * only its original; connectors bound at an end are left out (copying bindings is the clipboard's, M7). Returns the new records and the new ids of `ids`.
 *
 * @public
 */
export function duplicates(view: ReadView, ids: readonly RecordId[], newId: () => RecordId): { readonly records: AnyRecord[]; readonly ids: RecordId[] } {
  const all = [...new Set(ids.flatMap((id) => withMembers(view, id)))].filter((id) => view.get(id)?.type === 'element' && !bound(view, id));
  const renamed = new Map(all.map((id) => [id, newId()] as const));
  // each parent's siblings sorted once, however many of them are copied (M6.14 review F4)
  const sorted = new Map<string, string[]>();
  const indexesIn = (screen: RecordId, parent: RecordId | undefined) => {
    // tzap disable next-line StringLiteral: a cache key; any key per parent gives the same indexes
    const key = parent ?? `screen:${screen}`;
    const known = sorted.get(key) ?? siblingIndexes(view, screen, parent);
    // tzap disable next-line CallExpression: a cache; without it the indexes are only sorted again
    sorted.set(key, known);
    return known;
  };
  const records = all.map((id) => {
    const r = view.get(id) as AnyRecord & { readonly index: string; readonly screenId: RecordId; readonly parentId?: RecordId };
    const index = keyBetween(r.index, nextIndex(indexesIn(r.screenId, r.parentId), r.index));
    const parentId = r.parentId === undefined ? undefined : (renamed.get(r.parentId) ?? r.parentId);
    // tzap disable next-line ConditionalExpression: a parentId of undefined is no parentId once the record is written
    const copy = { ...r, id: renamed.get(id), index: index.ok ? index.value : r.index, ...(parentId !== undefined && { parentId }) };
    return withoutSlug(copy) as unknown as AnyRecord;
  });
  return { records, ids: ids.flatMap((id) => renamed.get(id) ?? []) };
}
