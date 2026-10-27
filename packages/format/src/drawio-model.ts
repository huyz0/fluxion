// draw.io model fragments (`<mxGraphModel>` library entries) to one SVG (ADR-0049). Vertices are drawn with the
// built-in shapes of drawio-shapes.ts, edges as polylines between clipped endpoints with simple arrowheads, labels as
// plain text lines. Styles are data: no expression, script or HTML is evaluated, and no image is fetched; an external
// image is drawn as a dashed placeholder and reported as an omission. This is not document import (M31).

import { arrowhead, type Point } from './drawio-arrows.js';
import { type Budget, color, type Label, labelSvg, num, numberOf, plainLabel, refuse, Sink, step } from './drawio-paint.js';
import { type Box, type Paint, type Style, shapeOf, shapeSvg } from './drawio-shapes.js';
import { elements, type XmlNode } from './drawio-xml.js';

const MAX_CELLS = 4096;
const MAX_ROUTE_DEPTH = 32;
const MAX_SVG_CHARS = 2 * 1024 * 1024;
const MAX_LABEL_CHARS = 4096;
type Cell = {
  readonly id: string;
  readonly parent: string | undefined;
  readonly vertex: boolean;
  readonly edge: boolean;
  readonly style: Style;
  readonly label: string;
  readonly source: string | undefined;
  readonly target: string | undefined;
  readonly geometry: XmlNode | undefined;
  /** Wrapper attributes that `%name%` placeholders may read, when `placeholders=1`. */
  readonly vars: ReadonlyMap<string, string> | undefined;
};
/** A converted fragment: SVG text, its size and what could not be drawn. */
type ModelSvg = { readonly svg: string; readonly w: number; readonly h: number; readonly omissions: readonly string[] };

type Scene = {
  readonly cells: ReadonlyMap<string, Cell>;
  readonly out: Sink;
  readonly budget: Budget;
  readonly omissions: string[];
  readonly origins: Map<string, Point>;
  /** Edges whose routes are being resolved: an edge label may not anchor its own edge. */
  readonly routing: Set<string>;
  /** Resolved routes, so label-anchored edges are routed once each (work stays linear in cells). */
  readonly routes: Map<string, Point[] | undefined>;
  bounds: [number, number, number, number];
};

function parseStyle(text: string): Style {
  const names = new Set<string>();
  const values = new Map<string, string>();
  for (const part of text.split(';')) {
    const at = part.indexOf('=');
    if (at < 0) {
      if (part.trim()) names.add(part.trim());
    } else values.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
  }
  return { names, values };
}

const RESERVED = new Set(['label', 'placeholders', 'id']);

/** The value of placeholder `key` from the nearest wrapper: the cell's own, then its ancestors'. */
function lookup(cells: ReadonlyMap<string, Cell>, from: { cell: Cell; budget: Budget }, key: string): string | undefined {
  if (RESERVED.has(key)) return undefined;
  let at: Cell | undefined = from.cell;
  for (let depth = 0; at && depth < 64; depth++) {
    step(from.budget, 1);
    const found = at.vars?.get(key);
    if (found !== undefined) return found;
    at = at.parent === undefined ? undefined : cells.get(at.parent);
  }
  return undefined;
}

/** `%name%` placeholders replaced as draw.io does when a wrapper sets `placeholders=1`. */
function resolvePlaceholders(cells: Map<string, Cell>, budget: Budget): void {
  for (const [id, cell] of cells) {
    if (cell.vars?.get('placeholders') !== '1') continue;
    // values may repeat: the resolved label is bounded while it is built, not after
    let size = cell.label.length;
    const label = cell.label.replace(/%([\w-]+)%/g, (all, key: string) => {
      const value = lookup(cells, { cell, budget }, key) ?? all;
      size += value.length - all.length;
      return size > MAX_LABEL_CHARS ? refuse(`resolved label exceeds ${MAX_LABEL_CHARS} characters: cell ${id}`) : value;
    });
    cells.set(id, { ...cell, label });
  }
}

function cellOf(node: XmlNode, wrapper: XmlNode | undefined): Cell {
  const a = node.attributes;
  const style = parseStyle(a.get('style') ?? '');
  const raw = wrapper ? (wrapper.attributes.get('label') ?? '') : (a.get('value') ?? '');
  const html = style.values.get('html') === '1';
  return {
    id: (wrapper ?? node).attributes.get('id') ?? refuse('cell without id'),
    parent: a.get('parent'),
    vertex: a.get('vertex') === '1',
    edge: a.get('edge') === '1',
    style,
    label: plainLabel(raw, html).replace(/ /g, ' '),
    source: a.get('source'),
    target: a.get('target'),
    geometry: elements(node, 'mxGeometry')[0],
    vars: wrapper?.attributes,
  };
}

/** A cell, unwrapping draw.io's `object`/`UserObject` label holders. */
function wrappedCell(node: XmlNode): Cell {
  if (node.name === 'mxCell') return cellOf(node, undefined);
  if (node.name !== 'object' && node.name !== 'UserObject') refuse(`unsupported-model-node: ${node.name}`);
  return cellOf(elements(node, 'mxCell')[0] ?? refuse('object without mxCell'), node);
}

function cellsOf(model: XmlNode, budget: Budget): Map<string, Cell> {
  if (model.name !== 'mxGraphModel') refuse('entry is not an mxGraphModel');
  const root = elements(model, 'root')[0] ?? refuse('model has no root');
  const cells = new Map<string, Cell>();
  for (const node of elements(root)) {
    const cell = wrappedCell(node);
    if (cells.has(cell.id) || cells.size >= MAX_CELLS) refuse('duplicate cell id or too many cells');
    cells.set(cell.id, cell);
  }
  resolvePlaceholders(cells, budget);
  return cells;
}

const geo = (cell: Cell, key: string): number => numberOf(cell.geometry?.attributes.get(key), 0);

/** Where a cell's children are positioned: the sum of its vertex ancestors' positions. */
function originOf(scene: Scene, id: string | undefined, depth = 0): Point {
  const cell = id === undefined ? undefined : scene.cells.get(id);
  if (!cell?.vertex) return [0, 0];
  const known = scene.origins.get(cell.id);
  if (known) return known;
  if (depth > 64) refuse('cell nesting too deep or cyclic');
  const [px, py] = originOf(scene, cell.parent, depth + 1);
  const origin: Point = [px + geo(cell, 'x'), py + geo(cell, 'y')];
  scene.origins.set(cell.id, origin);
  return origin;
}

/** The point at fraction `t` of a polyline's length. */
function along(route: readonly Point[], t: number, budget: Budget): Point {
  step(budget, route.length);
  const lengths = route.slice(1).map((p, i) => Math.hypot(p[0] - (route[i] as Point)[0], p[1] - (route[i] as Point)[1]));
  let left = Math.min(1, Math.max(0, t)) * lengths.reduce((a, b) => a + b, 0);
  for (const [i, length] of lengths.entries()) {
    if (left <= length && length > 0) {
      const [a, b] = [route[i] as Point, route[i + 1] as Point];
      return [a[0] + ((b[0] - a[0]) * left) / length, a[1] + ((b[1] - a[1]) * left) / length];
    }
    left -= length;
  }
  return route.at(-1) as Point;
}

/** A label vertex attached to an edge: geometry x runs -1..1 along the route, y and an offset point shift it. */
function edgeChildBox(scene: Scene, cell: Cell, parent: Cell): Box {
  const route = routeOf(scene, parent) ?? refuse(`edge label on a dangling edge: cell ${cell.id}`);
  const [px, py] = along(route, (geo(cell, 'x') + 1) / 2, scene.budget);
  const offset = cell.geometry ? elements(cell.geometry, 'mxPoint').find((p) => p.attributes.get('as') === 'offset') : undefined;
  const [ox, oy] = pointOf(offset, [0, geo(cell, 'y')]) ?? [0, geo(cell, 'y')];
  const [w, h] = [geo(cell, 'width'), geo(cell, 'height')];
  return { x: px + ox - w / 2, y: py + oy - h / 2, w, h };
}

function boxOf(scene: Scene, cell: Cell): Box {
  const parent = cell.parent === undefined ? undefined : scene.cells.get(cell.parent);
  if (parent?.edge && cell.geometry?.attributes.get('relative') === '1') return edgeChildBox(scene, cell, parent);
  const [x, y] = originOf(scene, cell.parent);
  const box = { x: x + geo(cell, 'x'), y: y + geo(cell, 'y'), w: geo(cell, 'width'), h: geo(cell, 'height') };
  if (box.w < 0 || box.h < 0) refuse('negative cell size');
  return box;
}

function include(scene: Scene, x: number, y: number, margin: number): void {
  const b = scene.bounds;
  scene.bounds = [Math.min(b[0], x - margin), Math.min(b[1], y - margin), Math.max(b[2], x + margin), Math.max(b[3], y + margin)];
}

type Strokes = { readonly stroke: string; readonly width: number; readonly attrs: string };

function strokesOf(style: Style, fallback: string): Strokes {
  const stroke = color(style.values.get('strokeColor'), fallback);
  const width = Math.max(0, numberOf(style.values.get('strokeWidth'), 1));
  const dash = style.values.get('dashed') === '1' ? ' stroke-dasharray="3 3"' : '';
  const opacity = numberOf(style.values.get('opacity'), 100);
  const alpha = opacity < 100 ? ` opacity="${num(Math.max(0, opacity) / 100)}"` : '';
  return { stroke, width, attrs: `stroke="${stroke}" stroke-width="${num(width)}"${dash}${alpha}` };
}

function paintOf(style: Style, box: Box): Paint {
  const fill = color(style.values.get('fillColor'), '#FFFFFF');
  const { attrs } = strokesOf(style, '#000000');
  return { box, style, both: `fill="${fill}" ${attrs}`, line: `fill="none" ${attrs}`, fill: `fill="${fill}" stroke="none"`, stroke: attrs };
}

/** The box a label is laid out in: the cell, its header for containers, or beside it for outside label positions. */
/** A container's header, where its label goes. */
function headerOf(cell: Cell, box: Box): Box {
  const shape = shapeOf(cell.style);
  if (shape !== 'swimlane' && shape !== 'table') return box;
  const start = numberOf(cell.style.values.get('startSize'), shape === 'table' ? 0 : 23);
  if (start <= 0) return box;
  return cell.style.values.get('horizontal') === '0' ? { ...box, w: start } : { ...box, h: start };
}

const SHIFT: Readonly<Record<string, number>> = { top: -1, left: -1, bottom: 1, right: 1 };

/** The box a label is laid out in: the cell, its header for containers, or beside it for outside label positions. */
function labelBox(cell: Cell, box: Box): Box {
  const out = headerOf(cell, box);
  const dy = (SHIFT[cell.style.values.get('verticalLabelPosition') ?? ''] ?? 0) * box.h;
  const dx = (SHIFT[cell.style.values.get('labelPosition') ?? ''] ?? 0) * box.w;
  return { ...out, x: out.x + dx, y: out.y + dy };
}

function label(scene: Scene, cell: Cell, box: Box, middle = false): string {
  const v = cell.style.values;
  const size = Math.max(1, numberOf(v.get('fontSize'), 11));
  const spec: Label = {
    text: cell.label,
    ...box,
    align: v.get('align') ?? 'center',
    valign: middle ? 'middle' : (v.get('verticalAlign') ?? 'middle'),
    size,
    color: color(v.get('fontColor'), '#000000'),
  };
  const svg = labelSvg(spec);
  if (svg && /[^\x20-\x7e\n]/.test(cell.label)) scene.omissions.push(`non-ascii-label-characters-replaced: cell ${cell.id}`);
  if (svg) {
    // no font metrics here: estimate the text extent so the viewport does not clip it
    const lines = cell.label.split('\n');
    const half = (lines.reduce((m, l) => Math.max(m, l.length), 0) * size * 0.3) | 0;
    include(scene, box.x + box.w / 2 - half, box.y + box.h / 2 - lines.length * size, 0);
    include(scene, box.x + box.w / 2 + half, box.y + box.h / 2 + lines.length * size, 0);
  }
  return svg;
}

function vertex(scene: Scene, cell: Cell): void {
  const box = boxOf(scene, cell);
  const shape = shapeOf(cell.style);
  if (shape.startsWith('mxgraph.')) refuse(`unsupported-stencil-shape: ${shape}`);
  const paint = paintOf(cell.style, box);
  const isImage = shape === 'image';
  if (isImage) scene.omissions.push(`external-image-not-fetched: cell ${cell.id}`);
  const body = isImage
    ? `<rect x="${num(box.x)}" y="${num(box.y)}" width="${num(box.w)}" height="${num(box.h)}" fill="none" stroke="#999999" stroke-dasharray="4 4"/>`
    : shapeSvg(shape, paint);
  const margin = strokesOf(cell.style, '#000000').width / 2;
  include(scene, box.x, box.y, margin);
  include(scene, box.x + box.w, box.y + box.h, margin);
  const rotation = numberOf(cell.style.values.get('rotation'), 0);
  const content = body + label(scene, cell, labelBox(cell, box));
  scene.out.push(rotation ? `<g transform="rotate(${num(rotation)} ${num(box.x + box.w / 2)} ${num(box.y + box.h / 2)})">${content}</g>` : content);
}

function pointOf(node: XmlNode | undefined, origin: Point): Point | undefined {
  if (!node) return undefined;
  return [origin[0] + numberOf(node.attributes.get('x'), 0), origin[1] + numberOf(node.attributes.get('y'), 0)];
}

/** Where a segment from inside `box` toward `to` leaves it. */
function clip(box: Box, from: Point, to: Point): Point {
  const [dx, dy] = [to[0] - from[0], to[1] - from[1]];
  const tx = dx === 0 ? Number.POSITIVE_INFINITY : (dx > 0 ? box.x + box.w - from[0] : box.x - from[0]) / dx;
  const ty = dy === 0 ? Number.POSITIVE_INFINITY : (dy > 0 ? box.y + box.h - from[1] : box.y - from[1]) / dy;
  const t = Math.min(tx, ty, 1);
  return Number.isFinite(t) && t > 0 ? [from[0] + dx * t, from[1] + dy * t] : from;
}

type End = { readonly point: Point; readonly box: Box | undefined };

/** One edge end: a constrained point on its terminal, the terminal's centre (clipped later), or the stored point. */
function endOf(scene: Scene, edge: Cell, which: 'source' | 'target'): End | undefined {
  const terminal = edge[which] === undefined ? undefined : scene.cells.get(edge[which] as string);
  if (terminal?.vertex) {
    const box = boxOf(scene, terminal);
    const key = which === 'source' ? 'exit' : 'entry';
    const fx = edge.style.values.get(`${key}X`);
    const fy = edge.style.values.get(`${key}Y`);
    if (fx !== undefined && fy !== undefined) return { point: [box.x + box.w * numberOf(fx, 0.5), box.y + box.h * numberOf(fy, 0.5)], box: undefined };
    return { point: [box.x + box.w / 2, box.y + box.h / 2], box };
  }
  const stored = edge.geometry ? elements(edge.geometry, 'mxPoint').find((p) => p.attributes.get('as') === `${which}Point`) : undefined;
  const point = pointOf(stored, originOf(scene, edge.parent));
  return point ? { point, box: undefined } : undefined;
}

/** An edge's route, memoized; label chains between edges are bounded in depth and may not loop. */
function routeOf(scene: Scene, edge: Cell): Point[] | undefined {
  if (scene.routes.has(edge.id)) return scene.routes.get(edge.id);
  if (scene.routing.has(edge.id)) refuse(`edge label anchors its own edge: cell ${edge.id}`);
  if (scene.routing.size >= MAX_ROUTE_DEPTH) refuse(`edges anchored on edge labels nest deeper than ${MAX_ROUTE_DEPTH}`);
  scene.routing.add(edge.id);
  const route = computeRoute(scene, edge);
  scene.routing.delete(edge.id);
  scene.routes.set(edge.id, route);
  return route;
}

function computeRoute(scene: Scene, edge: Cell): Point[] | undefined {
  const source = endOf(scene, edge, 'source');
  const target = endOf(scene, edge, 'target');
  if (!source || !target) return undefined;
  const origin = originOf(scene, edge.parent);
  const array = edge.geometry ? elements(edge.geometry, 'Array').find((a) => a.attributes.get('as') === 'points') : undefined;
  let middle = (array ? elements(array, 'mxPoint') : []).map((p) => pointOf(p, origin) as Point);
  if (!middle.length && edge.style.values.get('edgeStyle') === 'orthogonalEdgeStyle') {
    const mx = (source.point[0] + target.point[0]) / 2;
    middle = [
      [mx, source.point[1]],
      [mx, target.point[1]],
    ];
  }
  const first = middle[0] ?? target.point;
  const last = middle.at(-1) ?? source.point;
  const start = source.box ? clip(source.box, source.point, first) : source.point;
  const end = target.box ? clip(target.box, target.point, last) : target.point;
  return [start, ...middle, end];
}

function edge(scene: Scene, cell: Cell): void {
  const route = routeOf(scene, cell);
  if (!route) {
    scene.omissions.push(`dangling-edge: cell ${cell.id}`);
    return;
  }
  const v = cell.style.values;
  const flex = v.get('shape') === 'flexArrow';
  const strokes = strokesOf(cell.style, '#000000');
  const stroke = flex ? color(v.get('fillColor'), '#FFFFFF') : strokes.stroke;
  const width = flex ? numberOf(v.get('width'), 10) : strokes.width;
  const points = route.map(([x, y]) => `${num(x)},${num(y)}`).join(' ');
  const dash = v.get('dashed') === '1' ? ' stroke-dasharray="3 3"' : '';
  const size = Math.max(1, numberOf(v.get('endSize'), 6)) + (flex ? width : 0);
  const head = arrowhead(v.get('endArrow') ?? 'classic', route.at(-1) as Point, route.at(-2) as Point, {
    size,
    color: stroke,
    filled: v.get('endFill') !== '0',
  });
  const tail = arrowhead(v.get('startArrow') ?? 'none', route[0] as Point, route[1] as Point, {
    size: Math.max(1, numberOf(v.get('startSize'), 6)),
    color: stroke,
    filled: v.get('startFill') !== '0',
  });
  for (const [x, y] of route) include(scene, x, y, width / 2 + size);
  const mid = route[Math.floor((route.length - 1) / 2)] as Point;
  const next = route[Math.floor((route.length - 1) / 2) + 1] as Point;
  const text = label(scene, cell, { x: (mid[0] + next[0]) / 2, y: (mid[1] + next[1]) / 2, w: 0, h: 0 }, true);
  scene.out.push(`<polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="${num(width)}"${dash}/>${head}${tail}${text}`);
}

/** One model fragment as SVG over the bounds of everything it draws. */
export function modelSvg(model: XmlNode, budget: Budget): ModelSvg {
  const cells = cellsOf(model, budget);
  const scene: Scene = {
    cells,
    out: new Sink(Math.min(MAX_SVG_CHARS, budget.left)),
    budget,
    omissions: [],
    origins: new Map(),
    routing: new Set(),
    routes: new Map(),
    bounds: [Infinity, Infinity, -Infinity, -Infinity],
  };
  for (const cell of cells.values()) {
    step(budget, 1);
    if (cell.vertex) vertex(scene, cell);
    else if (cell.edge) edge(scene, cell);
  }
  const [x0, y0, x1, y1] = scene.bounds;
  const w = x1 - x0;
  const h = y1 - y0;
  if (!scene.out.parts.length || !(w > 0 && h > 0) || !Number.isFinite(w + h)) refuse('model draws nothing');
  const view = `${num(x0)} ${num(y0)} ${num(w)} ${num(h)}`;
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${num(w)}" height="${num(h)}" viewBox="${view}">${scene.out.parts.join('')}</svg>`,
    w,
    h,
    omissions: scene.omissions,
  };
}
