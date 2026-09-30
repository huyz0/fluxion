// A connector as hit-testing sees it (FR-EDT-004): its route within its stroke's reach, its markers
// and its labels. A registered marker is drawn MARKER_SIZE stroke widths across at its end (or the
// route's middle): it is hit within that size of the point. A label is centred at its place along the
// route (routing's labelPosition) and hit on an estimate of its text's box: its paragraphs in the
// style's font, at most LABEL_MAX_W wide as the content CSS draws it (the DOM is not measured).
import { MARKER_SIZE, type Store } from '@fluxion/core';
import { type Box, boxUnion, type Path, type PathCommand, pathBounds, pathFromCommands, type Vec2 } from '@fluxion/geometry';
import { plainParagraphs } from '@fluxion/render';
import { labelPosition, routeConnector, routePoint } from '@fluxion/routing';
import type { ConnectorElement, ElementRecord } from '@fluxion/schema';
import { resolveStyle } from '@fluxion/theme';
import { boxTouches, PAGE_FRAME } from './box-touch.js';
import { type Hittable, inBox, type Resolving } from './hittable.js';
import { grow, lengthOf, onStroked, reachOf, stroked, strokedBounds } from './stroke-band.js';

/** The widest a connector label is drawn (`.fx-connector-label` max-width), px. */
export const LABEL_MAX_W = 240;

/** A character's estimated width, in font sizes (a label is not measured to be hit). */
const CHAR_EM = 0.6;

/** A disc: a marker's reach about the point it is drawn at. */
type Disc = { readonly at: Vec2; readonly r: number };

const discBox = (d: Disc): Box => ({ x: d.at.x - d.r, y: d.at.y - d.r, w: 2 * d.r, h: 2 * d.r });

/** Whether `box` comes within `d`'s radius of its point. */
function boxNearDisc(box: Box, d: Disc): boolean {
  const dx = Math.max(box.x - d.at.x, 0, d.at.x - (box.x + box.w));
  const dy = Math.max(box.y - d.at.y, 0, d.at.y - (box.y + box.h));
  // tzap disable next-line EqualityOperator: a box exactly at the disc's edge
  return Math.hypot(dx, dy) <= d.r;
}

/** Whether boxes `a` and `b` overlap. */
const overlaps = (a: Box, b: Box): boolean => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;

/** The first and last points of a route. */
function ends(commands: readonly PathCommand[]): { readonly first: Vec2 | undefined; readonly last: Vec2 | undefined } {
  const points = commands.flatMap((c) => ('to' in c ? [c.to] : []));
  return { first: points[0], last: points.at(-1) };
}

/** The discs of the connector's registered markers, `size` across each. */
function markerDiscs(element: ConnectorElement, commands: readonly PathCommand[], ctx: Resolving, size: number): Disc[] {
  const registered = (id: string | undefined) => id !== undefined && ctx.registries.markers?.get(id) !== undefined;
  const { first, last } = ends(commands);
  const out: Disc[] = [];
  if (registered(element.markers?.start) && first !== undefined) out.push({ at: first, r: size });
  if (registered(element.markers?.end) && last !== undefined) out.push({ at: last, r: size });
  if (registered(element.markers?.mid)) out.push({ at: routePoint(commands, 0.5).point, r: size });
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
  const discs = markerDiscs(connector, routed.commands, ctx, MARKER_SIZE * line.stroke.width);
  const labels = labelBoxes(connector, routed.commands, { size: lengthOf(style.font.size, ctx.vars), line: lengthOf(style.font.lineHeight, ctx.vars) });
  const hits = (p: Vec2, tol: number) =>
    // tzap disable next-line BooleanLiteral: a centred stroke's band is the same on both sides
    onStroked(line, p, false, tol) ||
    // tzap disable next-line EqualityOperator: a point exactly at a marker's reach
    discs.some((d) => Math.hypot(p.x - d.at.x, p.y - d.at.y) <= d.r + tol) ||
    labels.some((b) => inBox(p, b, tol));
  const touches = (box: Box) =>
    // tzap disable next-line BooleanLiteral: a route is open, so it has no inside to fill
    boxTouches(path, false, grow(box, reachOf(line.stroke)), PAGE_FRAME) || discs.some((d) => boxNearDisc(box, d)) || labels.some((b) => overlaps(box, b));
  const drawn = [...discs.map(discBox), ...labels].reduce(boxUnion, strokedBounds(line, bounds));
  return { screenId: element.screenId, bounds: drawn, hits, touches };
}
