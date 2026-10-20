// Anchor snapping while connecting (FR-ANC-006, FR-ANC-003): the anchors an element offers as page points, which of them are full
// (their `max` connections, ADR-0043's `maxConnections`, reached by other connectors), and the one a drop snaps to: the nearest that is
// not full, within the tolerance. A drop farther than that from every free anchor binds `auto`, and so does one on the middle of a
// shape: a centre anchor is neither shown nor snapped to, and neither is one that floats (placed toward the other end, not fixed).
import type { ReadView, ShapeDef } from '@fluxion/core';
import type { Vec2 } from '@fluxion/geometry';
import { DEFAULT_ANCHORS, resolveAnchor, shapeAnchorTarget } from '@fluxion/routing';
import type { AnchorDef, RecordId, ShapeElement, Transform } from '@fluxion/schema';

/**
 * One anchor of an element, as the overlay draws it while connecting.
 *
 * @public
 */
export type AnchorDot = {
  /** The anchor's name. */
  readonly name: string;
  /** Where it sits, page units. */
  readonly point: Vec2;
  /** Whether it already has its `max` connections: nothing more attaches there. */
  readonly full: boolean;
  /** Whether a drop at the pointer would snap to it. */
  readonly snapped: boolean;
};

type Defs = { get(id: string): ShapeDef | undefined };
type BindingLike = { readonly type?: unknown; readonly connectorId?: unknown; readonly end?: unknown; readonly elementId?: unknown; readonly anchor?: unknown };

/** A connector end being placed: its own binding does not count against the anchor it lands on (its other end's does). */
export type EndRef = { readonly connector: RecordId; readonly end: 'source' | 'target' };

/** Whether `a` is the middle of its element: a press or drop on a shape's middle connects to the whole shape (`auto`), so it is no snap target. */
const middle = (a: AnchorDef): boolean => a.kind === 'center' || (a.kind === undefined && a.name === 'center' && a.x === 0.5 && a.y === 0.5);

/** The anchors `element` offers, its own first, then its definition's, then the defaults; one per name; not its middle. */
function anchorDefs(element: ShapeElement | undefined, def: ShapeDef | undefined): readonly AnchorDef[] {
  const seen = new Set<string>();
  // a name is taken by its first anchor even when that one is a middle, so a default it overrides stays hidden
  return [...(element?.anchors ?? []), ...(def?.anchors ?? []), ...DEFAULT_ANCHORS].filter((a) => {
    const first = !seen.has(a.name);
    seen.add(a.name);
    return first && !middle(a);
  });
}

/** How many connector ends other than `except` bind `elementId` at the anchor named `name`. */
function connections(view: ReadView, elementId: RecordId, name: string, except: EndRef | undefined): number {
  return view
    .members('bindingsByElement', elementId)
    .map((id) => view.get(id) as BindingLike | undefined)
    .filter((b) => {
      const anchor = b?.anchor as { readonly kind?: unknown; readonly name?: unknown } | undefined;
      return (
        b?.type === 'binding' &&
        b.elementId === elementId &&
        !(b.connectorId === except?.connector && b.end === except?.end) &&
        anchor?.kind === 'named' &&
        anchor.name === name
      );
    }).length;
}

/**
 * The anchors of `elementId` as dots for a pointer at `at`: each one's page point, whether it is full (connector ends other than `except`
 * fill its `max`), and the one a drop at `at` snaps to within `tolerance` (page units). Empty for an element without a box.
 */
export function anchorDots(
  view: ReadView,
  shapeDefs: Defs,
  target: { readonly elementId: RecordId; readonly at: Vec2; readonly tolerance: number; readonly except?: EndRef | undefined },
): readonly AnchorDot[] {
  const { elementId, at, tolerance, except } = target;
  const element = view.get(elementId) as (ShapeElement & { readonly transform?: Transform }) | undefined;
  if (element?.transform === undefined) return [];
  // only a shape has a definition with anchors of its own
  const shape = typeof (element as { defId?: unknown }).defId === 'string' ? element : undefined;
  const def = shape === undefined ? undefined : shapeDefs.get(shape.defId);
  const anchorTarget = shapeAnchorTarget(element.transform, def, element);
  const { x, y, w, h } = element.transform;
  // two points far apart on either side: an anchor that resolves to different places toward them floats (a perimeter anchor without
  // `t`, say): it has no place of its own to show or snap to, and routing places it toward the other end, not the pointer
  const far = Math.max(w, h, 1) * 1e3;
  const probes = [
    { x: x - far, y: y - far },
    { x: x + w + far, y: y + h + far },
  ] as const;
  const fixed = anchorDefs(shape, def).filter((a) => {
    const [p, q] = probes.map((toward) => resolveAnchor(anchorTarget, { kind: 'named', name: a.name }, toward).point);
    return p !== undefined && q !== undefined && Math.hypot(p.x - q.x, p.y - q.y) < 1e-6;
  });
  const dots = fixed.map((a) => {
    const point = resolveAnchor(anchorTarget, { kind: 'named', name: a.name }, at).point;
    const full = a.max !== undefined && connections(view, elementId, a.name, except) >= a.max;
    return { name: a.name, point, full, d: Math.hypot(point.x - at.x, point.y - at.y) };
  });
  const snap = dots
    .filter((d) => !d.full && d.d <= tolerance)
    .reduce<(typeof dots)[number] | undefined>((best, d) => (best === undefined || d.d < best.d ? d : best), undefined);
  return dots.map(({ name, point, full }) => ({ name, point, full, snapped: name === snap?.name }));
}

/**
 * The anchor a connector end dropped at `at` on `elementId` binds: the nearest anchor that is not full within `tolerance` (page units),
 * else `auto`.
 */
export function snapAnchor(
  view: ReadView,
  shapeDefs: Defs,
  target: { readonly elementId: RecordId; readonly at: Vec2; readonly tolerance: number; readonly except?: EndRef | undefined },
): { readonly kind: 'named'; readonly name: string } | { readonly kind: 'auto' } {
  const snapped = anchorDots(view, shapeDefs, target).find((d) => d.snapped);
  return snapped === undefined ? { kind: 'auto' } : { kind: 'named', name: snapped.name };
}
