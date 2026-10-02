// What a drag snaps to (FR-ARR-005, M8.10): the drawn boxes of the other elements of the screen, and the screen's own
// size. Read from the document, so the engine itself stays pure.
import type { ReadView } from '@fluxion/core';
import { type Box, elementBounds } from '@fluxion/geometry';
import { DEFAULT_SCREEN_SIZE, type RecordId } from '@fluxion/schema';

type Placed = { readonly parentId?: RecordId; readonly transform?: { x: number; y: number; w: number; h: number; rot?: number } };

/** The drawn bounds of the elements `ids` that have a box, or undefined when none has. */
export function boundsOf(view: ReadView, ids: readonly RecordId[]): Box | undefined {
  const boxes = ids.flatMap((id) => {
    const t = (view.get(id) as Placed | undefined)?.transform;
    return t === undefined ? [] : [elementBounds({ ...t, rot: t.rot ?? 0 })];
  });
  if (boxes.length === 0) return undefined;
  const x1 = Math.min(...boxes.map((b) => b.x));
  const y1 = Math.min(...boxes.map((b) => b.y));
  return { x: x1, y: y1, w: Math.max(...boxes.map((b) => b.x + b.w)) - x1, h: Math.max(...boxes.map((b) => b.y + b.h)) - y1 };
}

/**
 * The drawn boxes of the elements of `screen` that a drag of `moving` (and what moves with them) can snap to: all
 * but those, and the groups around them (a group's box follows its members, so it is no fixed target).
 */
export function snapTargets(view: ReadView, screen: RecordId, moving: ReadonlySet<RecordId>): Box[] {
  const around = new Set<RecordId>();
  for (const id of moving)
    for (let p = (view.get(id) as Placed | undefined)?.parentId; p !== undefined; p = (view.get(p) as Placed | undefined)?.parentId) around.add(p);
  const out: Box[] = [];
  for (const id of view.members('byScreen', screen)) {
    const box = moving.has(id) || around.has(id) ? undefined : boundsOf(view, [id]);
    if (box !== undefined) out.push(box);
  }
  return out;
}

/** The size of `screen` when its edges and centre are targets: undefined for an infinite screen or none. */
export function snapScreen(view: ReadView, screen: RecordId | undefined): { readonly w: number; readonly h: number } | undefined {
  const s = screen === undefined ? undefined : (view.get(screen) as { kind?: string; size?: { w?: number; h?: number } } | undefined);
  if (s === undefined || s.kind === 'infinite') return undefined;
  return { w: s.size?.w ?? DEFAULT_SCREEN_SIZE.w, h: s.size?.h ?? DEFAULT_SCREEN_SIZE.h };
}
