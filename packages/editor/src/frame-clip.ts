// Clipping frames under hit-testing (FR-ARR-006, M6 cp2 F4, ADR-0052): a frame with `clip` unset or true draws its members only
// inside its box, so a member is hit, and touched by a marquee, only there too. Every clipping frame above an element bounds it:
// its bounds shrink to what the frames show, a point outside any of them misses it, and a marquee touches it only where it overlaps
// them. A marquee meeting a turned frame is cut to the frame's upright bounds after it is checked to touch the frame itself.
import type { Store } from '@fluxion/core';
import { apply, type Box, boxIntersection, elementMatrix, invert, type Mat2d, transformBox } from '@fluxion/geometry';
import { type AnyRecord, type ElementRecord, type RecordId, transformRotation } from '@fluxion/schema';
import { boxTouches, rectOutline } from './box-touch.js';
import { type Hittable, inBox } from './hittable.js';

type Placed = { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly flipX?: boolean; readonly flipY?: boolean };
type Clip = { readonly bounds: Box; readonly inv: Mat2d; readonly w: number; readonly h: number; readonly upright: boolean };

/** The clip of a frame placed at `t`: page to its local box, and its upright bounds on the page. */
function clipOf(t: Placed): Clip {
  const rot = transformRotation(t as never);
  const m = elementMatrix({ x: t.x, y: t.y, w: t.w, h: t.h, rot, flipX: t.flipX === true, flipY: t.flipY === true });
  const inv = invert(m);
  return { bounds: transformBox(m, { x: 0, y: 0, w: t.w, h: t.h }), inv: inv.ok ? inv.value : m, w: t.w, h: t.h, upright: rot % 360 === 0 };
}

/** The clipping frames above `r`, nearest first: frames whose `clip` is not false. */
function clipsAbove(store: Store, r: ElementRecord): Clip[] {
  const clips: Clip[] = [];
  for (let at = r.parentId; at !== undefined; ) {
    const p = store.get(at) as (AnyRecord & { kind?: unknown; clip?: unknown; transform?: Placed; parentId?: RecordId }) | undefined;
    if (p === undefined) break;
    if (p.kind === 'frame' && p.clip !== false && p.transform !== undefined) clips.push(clipOf(p.transform));
    at = p.parentId;
  }
  return clips;
}

/** Whether page box `box` touches the inside of `c`, and the part of it within `c`'s upright bounds. */
function cut(c: Clip, box: Box): Box | undefined {
  const within = boxIntersection(box, c.bounds) ?? undefined;
  if (within === undefined || c.upright) return within;
  const outline = rectOutline(c.w, c.h);
  return outline !== undefined && boxTouches(outline, true, box, c.inv) ? within : undefined;
}

/**
 * `h`, the hittable of element `r`, bounded by every clipping frame above it (ADR-0052); undefined when they show none of it.
 */
export function clippedByFrames(store: Store, r: ElementRecord, h: Hittable): Hittable | undefined {
  const clips = clipsAbove(store, r);
  if (clips.length === 0) return h;
  let bounds: Box | undefined = h.bounds;
  for (const c of clips) bounds = bounds === undefined ? undefined : (boxIntersection(bounds, c.bounds) ?? undefined);
  if (bounds === undefined) return undefined;
  return {
    screenId: h.screenId,
    bounds,
    // a point is clipped exactly at the frame's edge: no pick margin outside what is shown
    hits: (p, tol) => clips.every((c) => inBox(apply(c.inv, p), { x: 0, y: 0, w: c.w, h: c.h }, 0)) && h.hits(p, tol),
    touches: (box) => {
      let left: Box | undefined = box;
      for (const c of clips) left = left === undefined ? undefined : cut(c, left);
      return left !== undefined && h.touches(left);
    },
  };
}
