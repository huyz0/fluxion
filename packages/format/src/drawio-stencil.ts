// draw.io stencil shapes (`<shape>` in a `<shapes>` library) to SVG text (ADR-0049). Supported: rect, roundrect,
// ellipse, path (move, line, quad, curve, arc, close), text, fill/stroke/fillstroke, paint state and save/restore,
// and connection constraints as anchors. Images, included shapes and unknown nodes refuse the shape.
import type { AnchorDef } from '@fluxion/schema';
import { type Budget, color, labelSvg, num, numberOf, refuse, Sink } from './drawio-paint.js';
import { elements, type XmlNode } from './drawio-xml.js';

type Paint = {
  fill: string;
  stroke: string;
  width: number;
  dash: string | undefined;
  join: string;
  cap: string;
  alpha: number;
  fillAlpha: number;
  strokeAlpha: number;
  fontColor: string;
  fontSize: number;
};
const JOINS = new Set(['miter', 'round', 'bevel']);
const CAPS = new Set(['flat', 'round', 'square']);
const MAX_SAVED = 64;
const MAX_DASH_VALUES = 16;
const MAX_ANCHORS = 256;
const MAX_SVG_CHARS = 2 * 1024 * 1024;

/** A converted stencil: its SVG, size and connection anchors. */
type StencilSvg = { readonly svg: string; readonly w: number; readonly h: number; readonly anchors: readonly AnchorDef[] };

type State = { paint: Paint; saved: Paint[]; path: string; readonly out: Sink };

const attr = (node: XmlNode, name: string): string | undefined => node.attributes.get(name);
const n = (node: XmlNode, name: string, fallback = 0): number => numberOf(attr(node, name), fallback);

function paintAttributes(p: Paint, fill: boolean, stroke: boolean): string {
  const parts = [`fill="${fill ? p.fill : 'none'}"`, `stroke="${stroke ? p.stroke : 'none'}"`];
  if (stroke) {
    parts.push(`stroke-width="${num(p.width)}"`, `stroke-linejoin="${p.join}"`, `stroke-linecap="${p.cap === 'flat' ? 'butt' : p.cap}"`);
    if (p.dash) parts.push(`stroke-dasharray="${p.dash}"`);
    if (p.strokeAlpha !== 1) parts.push(`stroke-opacity="${num(p.strokeAlpha)}"`);
  }
  if (fill && p.fillAlpha !== 1) parts.push(`fill-opacity="${num(p.fillAlpha)}"`);
  if (p.alpha !== 1) parts.push(`opacity="${num(p.alpha)}"`);
  return parts.join(' ');
}

type Rect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

function rectPath({ x, y, w, h }: Rect, r: number): string {
  if (w <= 0 || h <= 0) refuse('invalid-geometry');
  if (r <= 0) return `M${num(x)} ${num(y)}h${num(w)}v${num(h)}h${num(-w)}Z`;
  const k = Math.min(r, w / 2, h / 2);
  const a = `${num(k)} ${num(k)} 0 0 1`;
  return `M${num(x + k)} ${num(y)}H${num(x + w - k)}A${a} ${num(x + w)} ${num(y + k)}V${num(y + h - k)}A${a} ${num(x + w - k)} ${num(y + h)}H${num(x + k)}A${a} ${num(x)} ${num(y + h - k)}V${num(y + k)}A${a} ${num(x + k)} ${num(y)}Z`;
}

function ellipsePath({ x, y, w, h }: Rect): string {
  if (w <= 0 || h <= 0) refuse('invalid-geometry');
  const ry = h / 2;
  const a = `${num(w / 2)} ${num(ry)} 0 1 1`;
  return `M${num(x)} ${num(y + ry)}A${a} ${num(x + w)} ${num(y + ry)}A${a} ${num(x)} ${num(y + ry)}Z`;
}

const rectOf = (node: XmlNode): Rect => ({ x: n(node, 'x'), y: n(node, 'y'), w: n(node, 'w'), h: n(node, 'h') });
const coords = (op: XmlNode, names: readonly string[]): string => names.map((k) => num(n(op, k))).join(' ');
const flag = (op: XmlNode, name: string): number => (n(op, name) ? 1 : 0);
const PATH_OPS: Readonly<Record<string, (op: XmlNode) => string>> = {
  move: (op) => `M${coords(op, ['x', 'y'])}`,
  line: (op) => `L${coords(op, ['x', 'y'])}`,
  quad: (op) => `Q${coords(op, ['x1', 'y1', 'x2', 'y2'])}`,
  curve: (op) => `C${coords(op, ['x1', 'y1', 'x2', 'y2', 'x3', 'y3'])}`,
  arc: (op) => `A${coords(op, ['rx', 'ry', 'x-axis-rotation'])} ${flag(op, 'large-arc-flag')} ${flag(op, 'sweep-flag')} ${coords(op, ['x', 'y'])}`,
  close: () => 'Z',
};

function pathData(node: XmlNode): string {
  const d = elements(node)
    .map((op) => (Object.hasOwn(PATH_OPS, op.name) ? (PATH_OPS[op.name] as (op: XmlNode) => string)(op) : refuse(`unsupported-stencil-path-node: ${op.name}`)))
    .join('');
  return d.startsWith('M') ? d : refuse('stencil path must start with move');
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const dashPattern = (node: XmlNode, p: Paint): string | undefined => {
  const text = (attr(node, 'pattern') ?? '').trim();
  // the pattern is repeated on every later stroke, so its size is bounded rather than charged once
  if (text.length > MAX_DASH_VALUES * 12) refuse(`dash pattern exceeds ${MAX_DASH_VALUES} values`);
  const pattern = text.split(/\s+/).map(Number);
  if (pattern.length > MAX_DASH_VALUES) refuse(`dash pattern exceeds ${MAX_DASH_VALUES} values`);
  return pattern.length && pattern.every((v) => Number.isFinite(v) && v >= 0) ? pattern.map((v) => num(v * p.width)).join(' ') : p.dash;
};
const ignore = () => undefined;
/** Paint-state nodes; fonts are not chosen here (labels use the host default face). */
const PAINT_OPS: Readonly<Record<string, (p: Paint, node: XmlNode) => void>> = {
  strokecolor: (p, node) => {
    p.stroke = color(attr(node, 'color'), p.stroke);
  },
  fillcolor: (p, node) => {
    p.fill = color(attr(node, 'color'), p.fill);
  },
  fontcolor: (p, node) => {
    p.fontColor = color(attr(node, 'color'), p.fontColor);
  },
  strokewidth: (p, node) => {
    p.width = Math.max(0, n(node, 'width', 1));
  },
  fontsize: (p, node) => {
    p.fontSize = Math.max(1, n(node, 'size', 12));
  },
  dashed: (p, node) => {
    p.dash = n(node, 'dashed') ? (p.dash ?? '3 3') : undefined;
  },
  dashpattern: (p, node) => {
    p.dash = dashPattern(node, p);
  },
  linejoin: (p, node) => {
    if (JOINS.has(attr(node, 'join') ?? '')) p.join = attr(node, 'join') as string;
  },
  linecap: (p, node) => {
    if (CAPS.has(attr(node, 'cap') ?? '')) p.cap = attr(node, 'cap') as string;
  },
  alpha: (p, node) => {
    p.alpha = clamp01(n(node, 'alpha', 1));
  },
  fillalpha: (p, node) => {
    p.fillAlpha = clamp01(n(node, 'alpha', 1));
  },
  strokealpha: (p, node) => {
    p.strokeAlpha = clamp01(n(node, 'alpha', 1));
  },
  miterlimit: ignore,
  fontstyle: ignore,
  fontfamily: ignore,
};

const STATE_OPS: Readonly<Record<string, (state: State, node: XmlNode) => void>> = {
  fill: (state, node) => flush(state, node.name),
  stroke: (state, node) => flush(state, node.name),
  fillstroke: (state, node) => flush(state, node.name),
  text: (state, node) => {
    // a point label: a zero-size box at (x, y) aligned as the stencil says
    const p = state.paint;
    const spec = { text: attr(node, 'str') ?? '', x: n(node, 'x'), y: n(node, 'y'), w: 0, h: 0, size: p.fontSize, color: p.fontColor };
    state.out.push(labelSvg({ ...spec, align: attr(node, 'align') ?? 'center', valign: attr(node, 'valign') ?? 'middle' }));
  },
  save: (state) => {
    if (state.saved.length >= MAX_SAVED) refuse('stencil save depth');
    state.saved.push({ ...state.paint });
  },
  restore: (state) => {
    state.paint = state.saved.pop() ?? state.paint;
  },
};

/** Paint the current path as `kind` says, and start a new one. */
function flush(state: State, kind: string): void {
  if (state.path) state.out.push(`<path d="${state.path}" ${paintAttributes(state.paint, kind !== 'stroke', kind !== 'fill')}/>`);
  state.path = '';
}

function paintNode(state: State, node: XmlNode): void {
  if (Object.hasOwn(STATE_OPS, node.name)) (STATE_OPS[node.name] as (state: State, node: XmlNode) => void)(state, node);
  else if (Object.hasOwn(PAINT_OPS, node.name)) (PAINT_OPS[node.name] as (p: Paint, node: XmlNode) => void)(state.paint, node);
  else refuse(`unsupported-stencil-node: ${node.name}`);
}

/** Geometry nodes add to the current path; everything else paints or changes state. */
const GEOMETRY: Readonly<Record<string, (node: XmlNode) => string>> = {
  rect: (node) => rectPath(rectOf(node), 0),
  roundrect: (node) => {
    const r = rectOf(node);
    return rectPath(r, (Math.min(r.w, r.h) * n(node, 'arcsize', 15)) / 100);
  },
  ellipse: (node) => ellipsePath(rectOf(node)),
  path: pathData,
};

function drawNode(state: State, node: XmlNode): void {
  if (Object.hasOwn(GEOMETRY, node.name)) {
    state.path += (GEOMETRY[node.name] as (node: XmlNode) => string)(node);
    if (state.path.length > MAX_SVG_CHARS) refuse('stencil path exceeds 2 Mi characters');
  } else paintNode(state, node);
}

function anchorsOf(shape: XmlNode): AnchorDef[] {
  const connections = elements(shape, 'connections')[0];
  if (!connections) return [];
  const constraints = elements(connections, 'constraint');
  if (constraints.length > MAX_ANCHORS) refuse(`stencil exceeds ${MAX_ANCHORS} connection points`);
  return constraints.map((c, i) => {
    const x = n(c, 'x');
    const y = n(c, 'y');
    if (x < 0 || x > 1 || y < 0 || y > 1) refuse('constraint outside the shape');
    const name = attr(c, 'name');
    return { name: name && /^[\w-]{1,64}$/.test(name) ? name : `c${i + 1}`, x, y };
  });
}

const PAINT: Paint = {
  fill: '#FFFFFF',
  stroke: '#000000',
  width: 1,
  dash: undefined,
  join: 'miter',
  cap: 'flat',
  alpha: 1,
  fillAlpha: 1,
  strokeAlpha: 1,
  fontColor: '#000000',
  fontSize: 12,
};
const PAINTS = new Set(['fill', 'stroke', 'fillstroke']);

/** Draw the background, its implicit fill-and-stroke (unless the foreground starts by painting), then the foreground. */
function draw(shape: XmlNode, out: Sink): string[] {
  const state: State = { paint: { ...PAINT }, saved: [], path: '', out };
  const background = elements(shape, 'background')[0];
  const foreground = elements(shape, 'foreground')[0];
  for (const node of background ? elements(background) : []) drawNode(state, node);
  const first = foreground ? elements(foreground)[0]?.name : undefined;
  if (state.path && !PAINTS.has(first ?? '')) paintNode(state, { name: 'fillstroke', attributes: new Map(), children: [] });
  for (const node of foreground ? elements(foreground) : []) drawNode(state, node);
  return out.parts;
}

/** One stencil shape as SVG in its own w x h coordinate space; output is charged to the library budget as written. */
export function stencilSvg(shape: XmlNode, budget: Budget): StencilSvg {
  const w = n(shape, 'w', 100);
  const h = n(shape, 'h', 100);
  if (w <= 0 || h <= 0) refuse('invalid-stencil-size');
  const unknown = elements(shape).find((c) => !['connections', 'background', 'foreground'].includes(c.name));
  if (unknown) refuse(`unsupported-stencil-node: ${unknown.name}`);
  const out = draw(shape, new Sink(Math.min(MAX_SVG_CHARS, budget.left)));
  if (out.every((o) => o === '')) refuse('stencil paints nothing');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${num(w)}" height="${num(h)}" viewBox="0 0 ${num(w)} ${num(h)}">${out.join('')}</svg>`;
  return { svg, w, h, anchors: anchorsOf(shape) };
}
