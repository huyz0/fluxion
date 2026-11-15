// Frames carry their members (FR-ARR-006, ADR-0052, M19.10). Members keep screen coordinates, as a group's do, so a frame's move
// is the move of every element below it (translate.ts `movesFor`), and its turn and flip are computed here: each member's centre
// turned or mirrored about the frame's centre and its own turn and flips changed to match, so the frame and its content stay one
// picture. A frame's resize changes its box alone (the editor's resize handle). A pointer drag that ends with an element's centre
// inside a frame makes it that frame's member; one whose centre leaves its frame joins the frame's container. All of it is a list
// of `element.updateMany` updates, so a gesture writes it in its own transaction: one undo step.
import type { Vec2 } from '@fluxion/geometry';
import { compareKeys, keyBetween, type RecordId } from '@fluxion/schema';
import type { ReadView } from '../store.js';

type Vec = { readonly x: number; readonly y: number };
type Placed = Vec & { readonly w: number; readonly h: number; readonly rot?: number; readonly flipX?: boolean; readonly flipY?: boolean };
type El = {
  readonly type?: unknown;
  readonly kind?: unknown;
  readonly screenId?: RecordId;
  readonly parentId?: RecordId;
  readonly index?: string;
  readonly hidden?: boolean;
  readonly clip?: boolean;
  readonly layout?: { readonly live?: boolean };
  readonly transform?: Placed;
  readonly freeSource?: Vec;
  readonly freeTarget?: Vec;
  readonly route?: { readonly waypoints?: readonly Vec[] } & { readonly [field: string]: unknown };
};

/**
 * One element's changed fields, as `element.updateMany` takes them.
 *
 * @public
 */
export type FrameUpdate = {
  /** The element. */
  readonly id: RecordId;
  /** Its changed fields. */
  readonly fields: Record<string, unknown>;
};

const el = (view: ReadView, id: RecordId | undefined): El | undefined => (id === undefined ? undefined : (view.get(id) as El | undefined));
const below = (view: ReadView, id: RecordId): RecordId[] => view.members('byParent', id).flatMap((m) => [m, ...below(view, m)]);
const centreOf = (t: Placed): Vec => ({ x: t.x + t.w / 2, y: t.y + t.h / 2 });
const turnOf = (deg: number): number => ((deg % 360) + 360) % 360;
const rad = (deg: number): number => (deg * Math.PI) / 180;

/** The point map `at` applied to every placed field of `r` (its box's centre with `box`, a connector's free ends and waypoints). */
function carried(r: El, at: (p: Vec) => Vec, box: (t: Placed, centre: Vec) => Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (r.transform) fields['transform'] = box(r.transform, at(centreOf(r.transform)));
  if (r.freeSource) fields['freeSource'] = at(r.freeSource);
  if (r.freeTarget) fields['freeTarget'] = at(r.freeTarget);
  if (r.route?.waypoints) fields['route'] = { ...r.route, waypoints: r.route.waypoints.map(at) };
  return fields;
}

/** `frame` and every element below it, each with the fields `map` gives it; none when `frame` is not a frame with a box. */
function carry(view: ReadView, frame: RecordId, map: (r: El) => Record<string, unknown>): FrameUpdate[] {
  if (el(view, frame)?.kind !== 'frame' || el(view, frame)?.transform === undefined) return [];
  return [frame, ...below(view, frame)].flatMap((id) => {
    const r = el(view, id);
    const fields = r?.type === 'element' ? map(r) : {};
    return Object.keys(fields).length === 0 ? [] : [{ id, fields }];
  });
}

/**
 * The updates that turn frame `frame` by `deg` degrees with its members (ADR-0052): each one's centre turned about the frame's
 * centre and its own `rot` increased by `deg`; a connector's free ends and waypoints turned too. None when `frame` is no frame.
 *
 * @public
 */
export function frameTurned(view: ReadView, frame: RecordId, deg: number): FrameUpdate[] {
  const t = el(view, frame)?.transform;
  if (t === undefined) return [];
  const c = centreOf(t);
  const [cos, sin] = [Math.cos(rad(deg)), Math.sin(rad(deg))];
  const at = (p: Vec): Vec => ({ x: c.x + (p.x - c.x) * cos - (p.y - c.y) * sin, y: c.y + (p.x - c.x) * sin + (p.y - c.y) * cos });
  return carry(view, frame, (r) => carried(r, at, (b, m) => ({ ...b, x: m.x - b.w / 2, y: m.y - b.h / 2, rot: turnOf((b.rot ?? 0) + deg) })));
}

/**
 * The updates that flip frame `frame` with its members (ADR-0052): horizontally (`'x'`) each one's centre is mirrored across the
 * frame's vertical centre line (turned with the frame, at `φ`), its `flipX` toggled and its `rot` θ mapped to `2φ − θ`; vertically
 * (`'y'`) the same across the horizontal centre line with `flipY`. The frame itself keeps its turn (2φ − φ = φ). None when `frame`
 * is no frame.
 *
 * @public
 */
export function frameFlipped(view: ReadView, frame: RecordId, axis: 'x' | 'y'): FrameUpdate[] {
  const t = el(view, frame)?.transform;
  if (t === undefined) return [];
  const c = centreOf(t);
  const phi = t.rot ?? 0;
  // the mirror line through the centre: the frame's own y axis for a horizontal flip, its x axis for a vertical one
  const line = rad(axis === 'x' ? phi + 90 : phi);
  const u = { x: Math.cos(line), y: Math.sin(line) };
  const at = (p: Vec): Vec => {
    const d = { x: p.x - c.x, y: p.y - c.y };
    const along = d.x * u.x + d.y * u.y;
    return { x: c.x + 2 * along * u.x - d.x, y: c.y + 2 * along * u.y - d.y };
  };
  const flip = axis === 'x' ? 'flipX' : 'flipY';
  return carry(view, frame, (r) =>
    carried(r, at, (b, m) => ({ ...b, x: m.x - b.w / 2, y: m.y - b.h / 2, rot: turnOf(2 * phi - (b.rot ?? 0)), [flip]: !b[flip] })),
  );
}

/** The ids from the screen's top level down to `id`, as their index keys: the order elements are drawn in. */
function paintPath(view: ReadView, id: RecordId): string[] {
  const path: string[] = [];
  for (let at: RecordId | undefined = id; at !== undefined; at = el(view, at)?.parentId) path.unshift(el(view, at)?.index ?? '');
  return path;
}
function comparePaths(a: readonly string[], b: readonly string[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const c = compareKeys(a[i] as string, b[i] as string);
    if (c !== 0) return c;
  }
  return a.length - b.length;
}

/** Whether `p` lies inside the box `t`, turned about its centre by its `rot`. */
function inside(t: Placed, p: Vec): boolean {
  const c = centreOf(t);
  const [cos, sin] = [Math.cos(rad(-(t.rot ?? 0))), Math.sin(rad(-(t.rot ?? 0)))];
  const x = c.x + (p.x - c.x) * cos - (p.y - c.y) * sin;
  const y = c.y + (p.x - c.x) * sin + (p.y - c.y) * cos;
  return x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h;
}

/** Whether frame `id` can take a drop at `p`: shown (it and every container above it), and `p` inside it and every clipping frame above. */
function takes(view: ReadView, id: RecordId, p: Vec): boolean {
  const frame = el(view, id);
  if (frame?.transform === undefined || !inside(frame.transform, p)) return false;
  for (let at: El | undefined = frame; at !== undefined; at = el(view, at.parentId)) {
    if (at.hidden === true) return false;
    if (at !== frame && at.kind === 'frame' && at.clip !== false && (at.transform === undefined || !inside(at.transform, p))) return false;
  }
  return true;
}

/**
 * The frame an element dropped with its centre at `p` on screen `screen` joins (ADR-0052): the topmost frame there (so the deepest
 * of nested ones) that is shown and holds `p` inside its box and inside every clipping frame above it, leaving out the frames in
 * `moving` (the dragged elements and everything below them). Undefined when there is none.
 *
 * @public
 */
export function frameDropTarget(view: ReadView, screen: RecordId, p: Vec2, moving: ReadonlySet<RecordId>): RecordId | undefined {
  const frames = view.members('byScreen', screen).filter((id) => el(view, id)?.kind === 'frame' && !moving.has(id) && takes(view, id, p));
  return frames
    .map((id) => ({ id, path: paintPath(view, id) }))
    .sort((a, b) => comparePaths(a.path, b.path))
    .at(-1)?.id;
}

/** Of `ids`, each once, those with none of the others above them. */
function outermost(view: ReadView, ids: readonly RecordId[]): RecordId[] {
  const listed = new Set(ids);
  const above = (id: RecordId) => {
    for (let p = el(view, id)?.parentId; p !== undefined; p = el(view, p)?.parentId) if (listed.has(p)) return true;
    return false;
  };
  return [...listed].filter((id) => !above(id));
}

/** Where an element whose centre left its frames goes: its first container above that is no frame (a group), else the screen. */
function containerOutside(view: ReadView, r: El): RecordId | undefined {
  let at = r.parentId;
  while (at !== undefined && el(view, at)?.kind === 'frame') at = el(view, at)?.parentId;
  return at;
}

/** The index keys of the elements directly in `parent` of `screen` (its top level when undefined), sorted. */
function siblingKeys(view: ReadView, screen: RecordId, parent: RecordId | undefined): string[] {
  const ids = parent === undefined ? view.members('byScreen', screen).filter((id) => el(view, id)?.parentId === undefined) : view.members('byParent', parent);
  return ids.flatMap((id) => el(view, id)?.index ?? []).sort(compareKeys);
}

/**
 * The reparenting a pointer drag of `ids` ends with (ADR-0052): each dragged element (its dragged containers carry it) whose centre
 * now lies in a frame joins it (`frameDropTarget`), one whose centre left its frame joins the frame's container (the next frame up
 * that holds it, a group the frame sits in, or the screen). A member of a group stays in its group and a connector stays where it
 * is. A reparented element gets `parentId` and an index above its new siblings, in the dragged order, and `placement: 'auto'` when
 * the container it joins lays its children out live (ADR-0046), so the layout adopts it. To be written with the drag, one undo step.
 *
 * @public
 */
export function dropReparents(view: ReadView, ids: readonly RecordId[]): FrameUpdate[] {
  const dragged = outermost(view, ids)
    .filter((id) => el(view, id)?.type === 'element')
    .sort((a, b) => comparePaths(paintPath(view, a), paintPath(view, b)));
  const moving = new Set(dragged.flatMap((id) => [id, ...below(view, id)]));
  const next = new Map<string, { screen: RecordId; parent: RecordId | undefined; ids: RecordId[] }>();
  for (const id of dragged) {
    const r = el(view, id) as El;
    if (r.transform === undefined || r.screenId === undefined) continue; // a connector has no box: it stays where it is
    if (el(view, r.parentId)?.kind === 'group') continue;
    const parent = frameDropTarget(view, r.screenId, centreOf(r.transform), moving) ?? containerOutside(view, r);
    if (parent === r.parentId) continue;
    const key = `${r.screenId}\u0000${parent ?? ''}`;
    const entry = next.get(key) ?? { screen: r.screenId, parent, ids: [] };
    entry.ids.push(id);
    next.set(key, entry);
  }
  return [...next.values()].flatMap(({ screen, parent, ids: joining }) => {
    let low = siblingKeys(view, screen, parent).at(-1) ?? null;
    const live = el(view, parent)?.layout?.live === true;
    return joining.flatMap((id) => {
      const key = keyBetween(low, null);
      if (!key.ok) return [];
      low = key.value;
      return [{ id, fields: { parentId: parent, index: key.value, ...(live ? { placement: 'auto' } : {}) } }];
    });
  });
}
