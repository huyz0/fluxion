// Vertex shapes of draw.io model fragments as SVG text (ADR-0049): the common built-in shapes, drawn from their
// documented geometry. A named stencil (`mxgraph.*`) or any other shape is not guessed: it refuses the entry.
import { num, refuse } from './drawio-paint.js';

/** An absolute box. */
export type Box = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
/** A cell style: bare names and `key=value` pairs. */
export type Style = { readonly names: ReadonlySet<string>; readonly values: ReadonlyMap<string, string> };
/** What a painter needs: the box, style and the paint attributes for filled-and-stroked and stroke-only parts. */
export type Paint = {
  readonly box: Box;
  readonly style: Style;
  /** Filled and stroked. */
  readonly both: string;
  /** Stroked, unfilled. */
  readonly line: string;
  /** Filled, unstroked. */
  readonly fill: string;
  /** Stroke attributes only, for a part that chooses its own fill. */
  readonly stroke: string;
};

type Painter = (p: Paint) => string;

const value = (style: Style, key: string, fallback: number): number => {
  const raw = style.values.get(key);
  const n = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
};
const poly = (points: readonly (readonly [number, number])[], paint: string): string =>
  `<polygon points="${points.map(([x, y]) => `${num(x)},${num(y)}`).join(' ')}" ${paint}/>`;
const path = (d: string, paint: string): string => `<path d="${d}" ${paint}/>`;
type Pt = readonly [number, number];
const line = ([x1, y1]: Pt, [x2, y2]: Pt, paint: string): string => `<line x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}" ${paint}/>`;
/** A shape-size parameter: a fraction of `extent` unless `fixedSize` makes it absolute. */
const size = (p: Paint, fallback: number, extent: number): number =>
  p.style.values.get('fixedSize') === '1' ? value(p.style, 'size', fallback * extent) : value(p.style, 'size', fallback) * extent;

function rect(p: Paint): string {
  const { x, y, w, h } = p.box;
  const rounded = p.style.values.get('rounded') === '1';
  const arc = value(p.style, 'arcSize', 15);
  const r = !rounded ? 0 : p.style.values.get('absoluteArcSize') === '1' ? arc / 2 : (Math.min(w, h) * arc) / 100;
  const radius = r > 0 ? ` rx="${num(r)}" ry="${num(r)}"` : '';
  return `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}"${radius} ${p.both}/>`;
}

const ellipse = (p: Paint, inset = 0): string => {
  const { x, y, w, h } = p.box;
  return `<ellipse cx="${num(x + w / 2)}" cy="${num(y + h / 2)}" rx="${num(w / 2 - inset)}" ry="${num(h / 2 - inset)}" ${inset ? p.line : p.both}/>`;
};

function triangle(p: Paint): string {
  const { x, y, w, h } = p.box;
  const direction = p.style.values.get('direction') ?? 'east';
  const points: { readonly east: Pt[]; readonly [direction: string]: Pt[] } = {
    east: [
      [x, y],
      [x + w, y + h / 2],
      [x, y + h],
    ],
    west: [
      [x + w, y],
      [x, y + h / 2],
      [x + w, y + h],
    ],
    north: [
      [x, y + h],
      [x + w / 2, y],
      [x + w, y + h],
    ],
    south: [
      [x, y],
      [x + w / 2, y + h],
      [x + w, y],
    ],
  };
  // a style value is only a key of this table when it is one of its own directions, never an inherited name
  return poly(Object.hasOwn(points, direction) ? (points[direction] as Pt[]) : points.east, p.both);
}

function cylinder(p: Paint): string {
  const { x, y, w, h } = p.box;
  const dy = Math.min(value(p.style, 'size', 15), h / 2);
  const a = `${num(w / 2)} ${num(dy)} 0 0 1`;
  const body = `M${num(x)} ${num(y + dy)}A${a} ${num(x + w)} ${num(y + dy)}V${num(y + h - dy)}A${a} ${num(x)} ${num(y + h - dy)}Z`;
  const rim = `M${num(x)} ${num(y + dy)}A${num(w / 2)} ${num(dy)} 0 0 0 ${num(x + w)} ${num(y + dy)}`;
  return path(body, p.both) + path(rim, p.line);
}

function swimlane(p: Paint): string {
  const { x, y, w, h } = p.box;
  const start = Math.min(value(p.style, 'startSize', 23), p.style.values.get('horizontal') === '0' ? w : h);
  const header = p.style.values.get('horizontal') === '0' ? { x, y, w: start, h } : { x, y, w, h: start };
  const body = p.style.values.get('swimlaneFillColor');
  const bodyFill = body !== undefined && /^#[0-9a-fA-F]{3,6}$/.test(body) ? `fill="${body}" ` : 'fill="none" ';
  return (
    `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" ${bodyFill}${p.stroke}/>` +
    `<rect x="${num(header.x)}" y="${num(header.y)}" width="${num(header.w)}" height="${num(header.h)}" ${p.both}/>`
  );
}

function partialRectangle(p: Paint): string {
  const { x, y, w, h } = p.box;
  const on = (side: string) => p.style.values.get(side) !== '0';
  const sides = [
    on('top') ? line([x, y], [x + w, y], p.line) : '',
    on('right') ? line([x + w, y], [x + w, y + h], p.line) : '',
    on('bottom') ? line([x, y + h], [x + w, y + h], p.line) : '',
    on('left') ? line([x, y], [x, y + h], p.line) : '',
  ];
  return `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" ${p.fill}/>${sides.join('')}`;
}

function cloud(p: Paint): string {
  const { x, y, w, h } = p.box;
  const at = (fx: number, fy: number) => `${num(x + fx * w)} ${num(y + fy * h)}`;
  const curves: [number, number][][] = [
    [
      [0.05, 0.25],
      [0, 0.5],
      [0.16, 0.55],
    ],
    [
      [0, 0.66],
      [0.18, 0.9],
      [0.31, 0.8],
    ],
    [
      [0.4, 1],
      [0.7, 1],
      [0.8, 0.8],
    ],
    [
      [1, 0.8],
      [1, 0.6],
      [0.875, 0.5],
    ],
    [
      [1, 0.3],
      [0.8, 0.1],
      [0.625, 0.2],
    ],
    [
      [0.5, 0.05],
      [0.3, 0.05],
      [0.25, 0.25],
    ],
  ];
  return path(`M${at(0.25, 0.25)}${curves.map((c) => `C${c.map(([fx, fy]) => at(fx, fy)).join(' ')}`).join('')}Z`, p.both);
}

const PAINTERS: Readonly<Record<string, Painter>> = {
  rect,
  rectangle: rect,
  label: rect,
  text: () => '',
  ellipse: (p) => ellipse(p),
  doubleEllipse: (p) => ellipse(p) + ellipse(p, 4),
  rhombus: ({ box: { x, y, w, h }, both }) =>
    poly(
      [
        [x + w / 2, y],
        [x + w, y + h / 2],
        [x + w / 2, y + h],
        [x, y + h / 2],
      ],
      both,
    ),
  hexagon: (p) => {
    const { x, y, w, h } = p.box;
    const s = size(p, 0.25, w);
    return poly(
      [
        [x + s, y],
        [x + w - s, y],
        [x + w, y + h / 2],
        [x + w - s, y + h],
        [x + s, y + h],
        [x, y + h / 2],
      ],
      p.both,
    );
  },
  triangle,
  cylinder,
  cylinder3: cylinder,
  parallelogram: (p) => {
    const { x, y, w, h } = p.box;
    const s = size(p, 0.2, w);
    return poly(
      [
        [x + s, y],
        [x + w, y],
        [x + w - s, y + h],
        [x, y + h],
      ],
      p.both,
    );
  },
  step: (p) => {
    const { x, y, w, h } = p.box;
    const s = size(p, 0.2, w);
    return poly(
      [
        [x, y],
        [x + w - s, y],
        [x + w, y + h / 2],
        [x + w - s, y + h],
        [x, y + h],
        [x + s, y + h / 2],
      ],
      p.both,
    );
  },
  process: (p) => {
    const { x, y, w, h } = p.box;
    const s = size(p, 0.1, w);
    return rect(p) + line([x + s, y], [x + s, y + h], p.line) + line([x + w - s, y], [x + w - s, y + h], p.line);
  },
  document: (p) => {
    const { x, y, w, h } = p.box;
    const dy = h * value(p.style, 'size', 0.3) * 0.5;
    return path(
      `M${num(x)} ${num(y)}H${num(x + w)}V${num(y + h - dy)}C${num(x + 0.75 * w)} ${num(y + h - 3 * dy)} ${num(x + 0.25 * w)} ${num(y + h + dy)} ${num(x)} ${num(y + h - dy)}Z`,
      p.both,
    );
  },
  note: (p) => {
    const { x, y, w, h } = p.box;
    const s = Math.min(value(p.style, 'size', 30), w, h);
    return (
      poly(
        [
          [x, y],
          [x + w - s, y],
          [x + w, y + s],
          [x + w, y + h],
          [x, y + h],
        ],
        p.both,
      ) + path(`M${num(x + w - s)} ${num(y)}V${num(y + s)}H${num(x + w)}`, p.line)
    );
  },
  card: (p) => {
    const { x, y, w, h } = p.box;
    const s = Math.min(value(p.style, 'size', 30), w, h);
    return poly(
      [
        [x + s, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
        [x, y + s],
      ],
      p.both,
    );
  },
  swimlane,
  table: (p) => {
    const { x, y, w } = p.box;
    const start = value(p.style, 'startSize', 0);
    return rect(p) + (start > 0 ? line([x, y + start], [x + w, y + start], p.line) : '');
  },
  partialRectangle,
  line: ({ box: { x, y, w, h }, line: paint }) => line([x, y + h / 2], [x + w, y + h / 2], paint),
  cloud,
  umlLifeline: (p) => {
    const { x, y, w, h } = p.box;
    const head = Math.min(value(p.style, 'size', 40), h);
    return (
      `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(head)}" ${p.both}/>` +
      line([x + w / 2, y + head], [x + w / 2, y + h], `${p.line} stroke-dasharray="3 3"`)
    );
  },
};

/** The shape a style names: `shape=…`, else the first bare name that is a shape, else a rectangle. */
export function shapeOf(style: Style): string {
  const named = style.values.get('shape');
  if (named !== undefined) return named;
  for (const name of style.names) if (name === 'image' || Object.hasOwn(PAINTERS, name)) return name;
  return 'rect';
}

/** The markup of one vertex shape; refuses a shape it does not know. */
export function shapeSvg(shape: string, paint: Paint): string {
  const painter = Object.hasOwn(PAINTERS, shape) ? PAINTERS[shape] : undefined;
  return painter ? painter(paint) : refuse(`unsupported-shape: ${shape}`);
}
