// Frames carry their members (FR-ARR-006, ADR-0052, M19.10). Members keep screen coordinates, as a group's do, so a frame's move
// is the move of every element below it (translate.ts `movesFor`), its turn the editor's rotate handle (which turns a group's members
// the same way), and its flip flip.ts `elementFlipped` (which flips any element with what is below it). A frame's resize changes its
// box alone (the editor's resize handle). A pointer drag that ends with an element's centre
// inside a frame makes it that frame's member; one whose centre leaves its frame joins the frame's container. All of it is a list
// of `element.updateMany` updates, so a gesture writes it in its own transaction: one undo step.
import type { Vec2 } from '@fluxion/geometry';
import { compareKeys, keyBetween, type RecordId } from '@fluxion/schema';
import type { ReadView } from '../store.js';
import { below, centreOf, outermost, type Placed, rad, type Vec } from './placed.js';

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
const isFrame = (r: El | undefined): boolean => r?.kind === 'frame';

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
    if (at !== frame && isFrame(at) && at.clip !== false && (at.transform === undefined || !inside(at.transform, p))) return false;
  }
  return true;
}

/** The frames of `screen` that may take a drop, leaving out those in `moving`, topmost first (the deepest of nested ones first). */
function dropFrames(view: ReadView, screen: RecordId, moving: ReadonlySet<RecordId>): RecordId[] {
  return view
    .members('byScreen', screen)
    .filter((id) => isFrame(el(view, id)) && !moving.has(id))
    .map((id) => ({ id, path: paintPath(view, id) }))
    .sort((a, b) => comparePaths(b.path, a.path))
    .map((f) => f.id);
}

/**
 * The frame an element dropped with its centre at `p` on screen `screen` joins (ADR-0052): the topmost frame there (so the deepest
 * of nested ones) that is shown and holds `p` inside its box and inside every clipping frame above it, leaving out the frames in
 * `moving` (the dragged elements and everything below them). Undefined when there is none.
 *
 * @public
 */
export function frameDropTarget(view: ReadView, screen: RecordId, p: Vec2, moving: ReadonlySet<RecordId>): RecordId | undefined {
  return dropFrames(view, screen, moving).find((id) => takes(view, id, p));
}

/** Where an element whose centre left its frames goes: its first container above that is no frame (a group), else the screen. */
function containerOutside(view: ReadView, r: El): RecordId | undefined {
  let at = r.parentId;
  while (at !== undefined && isFrame(el(view, at))) at = el(view, at)?.parentId;
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
  // the screen's frames are found and ordered once per drag, not once per dragged element (M19 cp2 F7)
  const framesOf = new Map<RecordId, RecordId[]>();
  const targetOf = (screen: RecordId, p: Vec): RecordId | undefined => {
    const frames = framesOf.get(screen) ?? dropFrames(view, screen, moving);
    framesOf.set(screen, frames);
    return frames.find((id) => takes(view, id, p));
  };
  const next = new Map<string, { screen: RecordId; parent: RecordId | undefined; ids: RecordId[] }>();
  for (const id of dragged) {
    const r = el(view, id) as El;
    if (r.transform === undefined || r.screenId === undefined) continue; // a connector has no box: it stays where it is
    if (el(view, r.parentId)?.kind === 'group') continue;
    const parent = targetOf(r.screenId, centreOf(r.transform)) ?? containerOutside(view, r);
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
