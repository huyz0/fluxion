// The placed fields of an element and the maps that carry them (M19.35, M19 cp2 F4): a box's centre, a free connector's ends and its
// waypoints. Flip (flip.ts), the frames' drop rules (frames.ts) and match size's group scaling (match.ts) each give a point map and a
// box rule; `carried` applies them to every placed field the same way.
import type { RecordId } from '@fluxion/schema';
import type { ReadView } from '../store.js';

/** A point. */
export type Vec = { readonly x: number; readonly y: number };
/** An element's box: its top-left corner, size, turn and flips, and any other transform field. */
export type Placed = Vec & {
  readonly w: number;
  readonly h: number;
  readonly rot?: number;
  readonly flipX?: boolean;
  readonly flipY?: boolean;
  readonly [field: string]: unknown;
};
/** The fields of an element that say where it is. */
export type PlacedFields = {
  readonly transform?: Placed;
  readonly freeSource?: Vec;
  readonly freeTarget?: Vec;
  readonly route?: { readonly waypoints?: readonly Vec[] } & { readonly [field: string]: unknown };
};

/** The centre of box `t`. */
export const centreOf = (t: Placed): Vec => ({ x: t.x + t.w / 2, y: t.y + t.h / 2 });
/** `deg` in radians. */
export const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Every element below `id`, all the way down, in order. */
export const below = (view: ReadView, id: RecordId): RecordId[] => view.members('byParent', id).flatMap((m) => [m, ...below(view, m)]);

/** `id` and its members, all the way down, in order. */
export function withMembers(view: ReadView, id: RecordId): RecordId[] {
  return [id, ...below(view, id)];
}

/** Of `ids`, each once, those with none of the others above them (an element whose group is also listed goes with the group). */
export function outermost(view: ReadView, ids: readonly RecordId[]): RecordId[] {
  const listed = new Set(ids);
  const parentOf = (id: RecordId) => (view.get(id) as { parentId?: RecordId } | undefined)?.parentId;
  const above = (id: RecordId) => {
    for (let p = parentOf(id); p !== undefined; p = parentOf(p)) if (listed.has(p)) return true;
    return false;
  };
  return [...listed].filter((id) => !above(id));
}

/**
 * The point map `at` applied to every placed field of `r`: its box by `box` (given the box and its carried centre), a connector's
 * free ends and waypoints by `at` itself. Empty when `r` has nothing placed (a bound connector follows its ends).
 */
export function carried(r: PlacedFields, at: (p: Vec) => Vec, box: (t: Placed, centre: Vec) => Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (r.transform) fields['transform'] = box(r.transform, at(centreOf(r.transform)));
  if (r.freeSource) fields['freeSource'] = at(r.freeSource);
  if (r.freeTarget) fields['freeTarget'] = at(r.freeTarget);
  if (r.route?.waypoints) fields['route'] = { ...r.route, waypoints: r.route.waypoints.map(at) };
  return fields;
}
