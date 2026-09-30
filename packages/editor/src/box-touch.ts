// Whether a marquee touches what is drawn (FR-EDT-004, M6.13 review F1): its box crosses an outline,
// holds part of it, or lies inside a filled one; bounding boxes that merely overlap do not count.
// Pure geometry in the outline's own frame.
import { apply, type Box, intersectPaths, type Mat2d, type Path, type PathCommand, pathFromCommands, pointInPath, type Vec2 } from '@fluxion/geometry';

/**
 * The identity: an outline drawn in page coordinates (a connector's route).
 *
 * @public
 */
export const PAGE_FRAME: Mat2d = [1, 0, 0, 1, 0, 0];

/**
 * A box of `w` × `h` from the origin, as a closed outline.
 *
 * @public
 */
export function rectOutline(w: number, h: number): Path | undefined {
  const built = pathFromCommands(
    polygon([
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ]),
  );
  return built.ok ? built.value : undefined;
}

const polygon = (ps: readonly Vec2[]): PathCommand[] => [
  { kind: 'M', to: ps[0] as Vec2 },
  // tzap disable next-line MethodExpression: a line from the first corner to itself has no length
  ...ps.slice(1).map((to): PathCommand => ({ kind: 'L', to })),
  { kind: 'Z' },
];

/**
 * Whether the page box `box` touches the outline `outline`, drawn in the frame `inv` maps page points
 * into: it crosses the outline, holds a part of it, or lies inside it when it is filled.
 *
 * @public
 */
export function boxTouches(outline: Path, filled: boolean, box: Box, inv: Mat2d): boolean {
  const corners = [
    { x: box.x, y: box.y },
    { x: box.x + box.w, y: box.y },
    { x: box.x + box.w, y: box.y + box.h },
    { x: box.x, y: box.y + box.h },
  ].map((p) => apply(inv, p));
  const inside = filled && outline.closed && pointInPath(outline, corners[0] as Vec2, 'nonzero');
  const area = pathFromCommands(polygon(corners));
  // a box whose corners are no numbers makes no area: it touches only a filled inside, which it is not in
  if (!area.ok) return inside;
  const start = outline.segments[0]?.p0;
  if (start !== undefined && pointInPath(area.value, start, 'nonzero')) return true;
  return inside || intersectPaths(outline, area.value).length > 0;
}
