// The ends of a straight connector (FR-CON-001, R0): a bound end starts at the bound element's centre
// and is clipped to its outline box on the line towards the other end; a free end is its stored point.
// Anchors (named, side, point) arrive with M5 and are read as `auto` until then; routes other than
// straight (and waypoints) arrive with routing (M9) and draw straight meanwhile.
import type { ReadView } from '@fluxion/core';
import { elementCorners, intersectSegments, type Vec2 } from '@fluxion/geometry';
import { type RecordId, type Transform, transformRotation } from '@fluxion/schema';

type End = 'source' | 'target';
type EndRecord = { readonly type?: unknown; readonly connectorId?: unknown; readonly end?: unknown; readonly elementId?: unknown };

/** The corners of the element an end is bound to; undefined for a free end, null when the bound element has no box. */
function boundCorners(view: ReadView, connectorId: RecordId, end: End): readonly Vec2[] | undefined | null {
  const binding = view
    .members('bindingsByElement', connectorId)
    .map((id) => view.get(id) as EndRecord | undefined)
    .find((b) => b?.type === 'binding' && b.connectorId === connectorId && b.end === end);
  if (binding === undefined) return undefined;
  const target = view.get(binding.elementId as RecordId) as { readonly transform?: Transform } | undefined;
  // bound to an element without a box (or a missing one): the end cannot be placed
  return target?.transform === undefined ? null : elementCorners({ ...target.transform, rot: transformRotation(target.transform) });
}

const centre = (corners: readonly Vec2[]): Vec2 => ({
  x: corners.reduce((s, p) => s + p.x, 0) / corners.length,
  y: corners.reduce((s, p) => s + p.y, 0) / corners.length,
});

/** Where the segment from `from` (inside the outline) towards `to` leaves the outline; `from` when it does not. */
function clip(corners: readonly Vec2[], from: Vec2, to: Vec2): Vec2 {
  for (let i = 0; i < corners.length; i++) {
    const hit = intersectSegments([from, to], [corners[i] as Vec2, corners[(i + 1) % corners.length] as Vec2]);
    if (hit !== null) return hit;
  }
  return from;
}

/**
 * The two ends of a connector, in screen coordinates.
 *
 * @public
 */
export type ConnectorEnds = {
  /** Where the line starts. */
  readonly source: Vec2;
  /** Where the line ends. */
  readonly target: Vec2;
};

/**
 * The two ends of the straight connector `connectorId`, in screen coordinates; undefined when an end
 * can be placed neither from a binding nor from a free point.
 *
 * @public
 */
export function connectorEnds(view: ReadView, connectorId: RecordId): ConnectorEnds | undefined {
  const connector = view.get(connectorId) as { readonly freeSource?: Vec2; readonly freeTarget?: Vec2 } | undefined;
  if (connector === undefined) return undefined;
  const ends = (['source', 'target'] as const).map((end) => {
    const corners = boundCorners(view, connectorId, end);
    const free = end === 'source' ? connector.freeSource : connector.freeTarget;
    if (corners === null || (corners === undefined && free === undefined)) return undefined;
    return corners === undefined ? { at: free as Vec2 } : { at: centre(corners), corners };
  });
  const [source, target] = ends;
  if (source === undefined || target === undefined) return undefined;
  return {
    source: source.corners === undefined ? source.at : clip(source.corners, source.at, target.at),
    target: target.corners === undefined ? target.at : clip(target.corners, target.at, source.at),
  };
}
