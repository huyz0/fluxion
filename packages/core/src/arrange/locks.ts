// Editing locks (FR-SHP-008, ADR-0054): whether an element holds a lock, read the same way by core's arranging commands and the
// editor's tools. A lock stops a direct change of that kind (a drag, a nudge, an align, a match): `position` the place, `size` the
// box's size, `rotation` the turn, `edit` the content and style; `aspect` keeps the ratio through a resize; `select` keeps a click or
// a marquee on the canvas from picking it (the layers panel still does). A locked member of a group moved as a whole goes with it.
import type { RecordId } from '@fluxion/schema';
import type { ReadView } from '../store.js';

/**
 * A lock an element may hold.
 *
 * @public
 */
export type LockName = 'position' | 'size' | 'rotation' | 'delete' | 'edit' | 'aspect' | 'select';

/**
 * Whether element `id` holds `lock`.
 *
 * @public
 */
export function hasLock(view: ReadView, id: RecordId, lock: LockName): boolean {
  const locks = (view.get(id) as { locks?: Record<string, unknown> } | undefined)?.locks;
  return locks?.[lock] === true;
}

/**
 * Whether element `id` or a group or frame it sits in holds `lock` (a group the canvas cannot select keeps its members unselectable too).
 *
 * @public
 */
export function lockedWithin(view: ReadView, id: RecordId, lock: LockName): boolean {
  for (let at: RecordId | undefined = id; at !== undefined; at = (view.get(at) as { parentId?: RecordId } | undefined)?.parentId)
    if (hasLock(view, at, lock)) return true;
  return false;
}
