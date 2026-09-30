// A connector as hit-testing sees it (FR-EDT-004): its route within its stroke's reach, its markers
// and its labels. A registered marker is drawn in a box MARKER_SIZE stroke widths across, from its
// tip at the route's end back along the route (or about the route's middle), and is hit there. A
// label is centred at its place along the route (routing's labelPosition) and hit on an estimate of
// its text's box: its paragraphs in the
// style's font, at most LABEL_MAX_W wide as the content CSS draws it (the DOM is not measured).
import { MARKER_SIZE, type Store } from '@fluxion/core';
import { type Box, boxFromPoints, boxUnion, type Mat2d, type Path, type PathCommand, pathBounds, pathFromCommands, type Vec2 } from '@fluxion/geometry';
import { plainParagraphs } from '@fluxion/render';
import { labelPosition, routeConnector, routePoint } from '@fluxion/routing';
import type { ConnectorElement, ElementRecord } from '@fluxion/schema';
import { resolveStyle } from '@fluxion/theme';
import { boxTouches, PAGE_FRAME, rectOutline } from './box-touch.js';
import { type Hittable, inBox, type Resolving } from './hittable.js';
import { grow, lengthOf, onStroked, reachOf, stroked, strokedBounds } from './stroke-band.js';

/** The widest a connector label is drawn (`.fx-connector-label` max-width), px. */
export const LABEL_MAX_W = 240;

/** A character's estimated width, in font sizes (a label is not measured to be hit). */
const CHAR_EM = 0.6;

/**
 * Where a marker is drawn: a box from `o` along the unit direction `u` for `len`, `half` to either side
 * of that axis (its 10 × 10 box, MARKER_SIZE stroke widths across).
 */
type MarkerBox = { readonly o: Vec2; readonly u: Vec2; readonly len: number; readonly half: number };

/** The normal to `u`, a quarter turn clockwise on screen. */
const normal = (u: Vec2): Vec2 => ({ x: -u.y, y: u.x });

/** Whether `p` is on the marker box `m`, or `tolerance` of it. */
function onMarker(m: MarkerBox, p: Vec2, tolerance: number): boolean {
  const d = { x: p.x - m.o.x, y: p.y - m.o.y };
  const n = normal(m.u);
  const along = d.x * m.u.x + d.y * m.u.y;
  const across = d.x * n.x + d.y * n.y;
  // tzap disable next-line EqualityOperator: a point exactly at the margin's edge
  return along >= -tolerance && along <= m.len + tolerance && Math.abs(across) <= m.half + tolerance;
}

/** The corners of the marker box `m`, clockwise from its start's one side. */
function markerCorners(m: MarkerBox): Vec2[] {
  const n = normal(m.u);
  // tzap disable next-line ArithmeticOperator: the corners lie at ±half across, so either sign gives the same four
  const at = (t: number, c: number) => ({ x: m.o.x + t * m.u.x + c * n.x, y: m.o.y + t * m.u.y + c * n.y });
  return [at(0, -m.half), at(m.len, -m.half), at(m.len, m.half), at(0, m.half)];
}

/** Whether the page box `box` touches the marker box `m`. */
function boxNearMarker(box: Box, m: MarkerBox): boolean {
  const n = normal(m.u);
  // page to the marker's own frame: along u from its start's corner, and across along n
  const q = { x: m.o.x - m.half * n.x, y: m.o.y - m.half * n.y };
  const inv: Mat2d = [m.u.x, n.x, m.u.y, n.y, -(q.x * m.u.x + q.y * m.u.y), -(q.x * n.x + q.y * n.y)];
  const outline = rectOutline(m.len, 2 * m.half);
  return outline !== undefined && boxTouches(outline, true, box, inv);
}

/** Whether boxes `a` and `b` overlap. */
const overlaps = (a: Box, b: Box): boolean => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;

/** The unit direction of `v`, or along x for none. */
function unit(v: Vec2): Vec2 {
  const l = Math.hypot(v.x, v.y);
  // tzap disable next-line ArithmeticOperator: routing's directions are unit already (l is 1); normalised in case one is not
  return l === 0 ? { x: 1, y: 0 } : { x: v.x / l, y: v.y / l };
}

/**
 * The boxes of the connector's registered markers, `size` across: the start's and end's from their
 * tip, at the route's end, back along the route; the middle one's about the route's middle.
 */
function markerBoxes(element: ConnectorElement, commands: readonly PathCommand[], ctx: Resolving, size: number): MarkerBox[] {
  const registered = (id: string | undefined) => id !== undefined && ctx.registries.markers?.get(id) !== undefined;
  const half = size / 2;
  const out: MarkerBox[] = [];
  if (registered(element.markers?.start)) {
    const s = routePoint(commands, 0);
    out.push({ o: s.point, u: unit(s.dir), len: size, half });
  }
  if (registered(element.markers?.end)) {
    const e = routePoint(commands, 1);
    const u = unit(e.dir);
    out.push({ o: { x: e.point.x - size * u.x, y: e.point.y - size * u.y }, u, len: size, half });
  }
  if (registered(element.markers?.mid)) {
    const m = routePoint(commands, 0.5);
    const u = unit(m.dir);
    out.push({ o: { x: m.point.x - half * u.x, y: m.point.y - half * u.y }, u, len: size, half });
  }
  return out;
}

/** The estimated boxes of the connector's labels with text, centred at their places along the route. */
function labelBoxes(element: ConnectorElement, commands: readonly PathCommand[], font: { readonly size: number; readonly line: number }): Box[] {
  return (element.labels ?? []).flatMap((label) => {
    const lines = plainParagraphs(label.text);
    // a label without text draws nothing to hit
    if (lines.every((l) => l === '')) return [];
    const at = labelPosition(commands, label.position, label.offset);
    const w = Math.min(LABEL_MAX_W, Math.max(...lines.map((l) => l.length)) * CHAR_EM * font.size + 8);
    const h = lines.length * font.size * font.line + 2;
    return [{ x: at.x - w / 2, y: at.y - h / 2, w, h }];
  });
}

/**
 * A connector hit along its route within its stroke's reach, on its markers and on its labels.
 *
 * @public
 */
export function connectorHittable(store: Store, ctx: Resolving, element: ElementRecord): Hittable | undefined {
  const routed = routeConnector(store, ctx.registries, element.id);
  if (routed === undefined) return undefined;
  const built = pathFromCommands(routed.commands);
  if (!built.ok) return undefined;
  const path: Path = built.value;
  const bounds = pathBounds(path);
  if (bounds === null) return undefined;
  const connector = element as ConnectorElement;
  // tzap disable next-line StringLiteral, ArrayDeclaration: the path only locates diagnostics, which hit-testing drops
  const { style } = resolveStyle(connector.style, 'connector', ctx.theme, ['records', element.id, 'style']);
  // a route is open: its stroke is centred, whatever the style's alignment
  const line = stroked(path, style.stroke, ctx.vars);
  const markers = markerBoxes(connector, routed.commands, ctx, MARKER_SIZE * line.stroke.width);
  const labels = labelBoxes(connector, routed.commands, { size: lengthOf(style.font.size, ctx.vars), line: lengthOf(style.font.lineHeight, ctx.vars) });
  const hits = (p: Vec2, tol: number) =>
    // tzap disable next-line BooleanLiteral: a centred stroke's band is the same on both sides
    onStroked(line, p, false, tol) || markers.some((m) => onMarker(m, p, tol)) || labels.some((b) => inBox(p, b, tol));
  const touches = (box: Box) =>
    // tzap disable next-line BooleanLiteral: a route is open, so it has no inside to fill
    boxTouches(path, false, grow(box, reachOf(line.stroke)), PAGE_FRAME) || markers.some((m) => boxNearMarker(box, m)) || labels.some((b) => overlaps(box, b));
  const marked = markers.flatMap((m) => boxFromPoints(markerCorners(m)) ?? []);
  const drawn = [...marked, ...labels].reduce(boxUnion, strokedBounds(line, bounds));
  return { screenId: element.screenId, bounds: drawn, hits, touches };
}
