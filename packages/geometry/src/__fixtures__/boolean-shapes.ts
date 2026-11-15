// Operands for the boolean-operation tests (ADR-0053): a rectangle, a circle, a five-pointed star and a rounded rectangle, each
// with its exact area, built from the outline commands a shape definition would give.
import type { BooleanOperand } from '../boolean.js';
import { identity, type Mat2d, multiply, scaling, translate } from '../mat2d.js';
import { type Path, type PathCommand, pathFromCommands } from '../path.js';
import type { FillRule } from '../point-in-path.js';
import type { Vec2 } from '../vec2.js';

/** The cubic circle constant: a quarter arc's handle length over the radius. */
const K = 0.5522847498307936;

const path = (cmds: readonly PathCommand[]): Path => {
  const p = pathFromCommands(cmds);
  if (!p.ok) throw new Error(p.error.message);
  return p.value;
};

/** A polygon through `pts`, closed. */
export const polygon = (pts: readonly Vec2[]): Path =>
  path([{ kind: 'M', to: pts[0] as Vec2 }, ...pts.slice(1).map((to): PathCommand => ({ kind: 'L', to })), { kind: 'Z' }]);

/** The rectangle (x, y, w, h), clockwise on screen. */
export const rect = (x: number, y: number, w: number, h: number): Path =>
  polygon([
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ]);

/** The circle of centre (cx, cy) and radius r as four cubics, clockwise on screen. */
export function circle(cx: number, cy: number, r: number): Path {
  const k = K * r;
  return path([
    { kind: 'M', to: { x: cx + r, y: cy } },
    { kind: 'C', control1: { x: cx + r, y: cy + k }, control2: { x: cx + k, y: cy + r }, to: { x: cx, y: cy + r } },
    { kind: 'C', control1: { x: cx - k, y: cy + r }, control2: { x: cx - r, y: cy + k }, to: { x: cx - r, y: cy } },
    { kind: 'C', control1: { x: cx - r, y: cy - k }, control2: { x: cx - k, y: cy - r }, to: { x: cx, y: cy - r } },
    { kind: 'C', control1: { x: cx + k, y: cy - r }, control2: { x: cx + r, y: cy - k }, to: { x: cx + r, y: cy } },
    { kind: 'Z' },
  ]);
}

/** Three-point Gauss–Legendre nodes and weights on [0, 1]: exact for the degree-5 integrand of a cubic's area. */
const GAUSS = [
  [0.5 - Math.sqrt(0.15), 5 / 18],
  [0.5, 8 / 18],
  [0.5 + Math.sqrt(0.15), 5 / 18],
] as const;

/** The signed area of the closed cubic rings `segments` (Green's theorem, y down: positive is clockwise on screen). */
export function signedArea(segments: Path['segments']): number {
  let sum = 0;
  for (const s of segments) {
    for (const [t, w] of GAUSS) {
      const u = 1 - t;
      const x = u * u * u * s.p0.x + 3 * u * u * t * s.p1.x + 3 * u * t * t * s.p2.x + t * t * t * s.p3.x;
      const y = u * u * u * s.p0.y + 3 * u * u * t * s.p1.y + 3 * u * t * t * s.p2.y + t * t * t * s.p3.y;
      const dx = 3 * (u * u * (s.p1.x - s.p0.x) + 2 * u * t * (s.p2.x - s.p1.x) + t * t * (s.p3.x - s.p2.x));
      const dy = 3 * (u * u * (s.p1.y - s.p0.y) + 2 * u * t * (s.p2.y - s.p1.y) + t * t * (s.p3.y - s.p2.y));
      sum += (w * (x * dy - y * dx)) / 2;
    }
  }
  return sum;
}

/** The area `p` encloses. */
export const areaOf = (p: Path): number => Math.abs(signedArea(p.segments));

/** A five-pointed star (a simple concave ring) of centre (cx, cy), outer radius r and inner radius ri. */
export function star(cx: number, cy: number, r: number, ri: number): { readonly path: Path; readonly area: number } {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? r : ri;
    return { x: cx + rad * Math.cos(a), y: cy + rad * Math.sin(a) };
  });
  // ten triangles from the centre, each with sides r and ri at 36°
  return { path: polygon(pts), area: 10 * 0.5 * r * ri * Math.sin(Math.PI / 5) };
}

/** A rounded rectangle `box` with corner radius rr, each corner a cubic quarter. */
export function roundedRect(
  box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
  rr: number,
): { readonly path: Path; readonly area: number } {
  const { x, y, w, h } = box;
  const k = K * rr;
  const p = path([
    { kind: 'M', to: { x: x + rr, y } },
    { kind: 'L', to: { x: x + w - rr, y } },
    { kind: 'C', control1: { x: x + w - rr + k, y }, control2: { x: x + w, y: y + rr - k }, to: { x: x + w, y: y + rr } },
    { kind: 'L', to: { x: x + w, y: y + h - rr } },
    { kind: 'C', control1: { x: x + w, y: y + h - rr + k }, control2: { x: x + w - rr + k, y: y + h }, to: { x: x + w - rr, y: y + h } },
    { kind: 'L', to: { x: x + rr, y: y + h } },
    { kind: 'C', control1: { x: x + rr - k, y: y + h }, control2: { x, y: y + h - rr + k }, to: { x, y: y + h - rr } },
    { kind: 'L', to: { x, y: y + rr } },
    { kind: 'C', control1: { x, y: y + rr - k }, control2: { x: x + rr - k, y }, to: { x: x + rr, y } },
    { kind: 'Z' },
  ]);
  return { path: p, area: areaOf(p) };
}

/** An operand of `rings`, placed by `matrix` (default: where they are), filled under `fillRule` (default nonzero). */
export const operand = (rings: readonly Path[], matrix: Mat2d = identity(), fillRule: FillRule = 'nonzero'): BooleanOperand => ({ rings, matrix, fillRule });

/** The matrix flipping horizontally about the vertical line x = cx. */
export const flipX = (cx: number): Mat2d => multiply(translate(cx, 0), multiply(scaling(-1, 1), translate(-cx, 0)));

/** `p` with every ring reversed. */
export function reversed(p: Path): Path {
  return { closed: p.closed, segments: [...p.segments].reverse().map((s) => ({ p0: s.p3, p1: s.p2, p2: s.p1, p3: s.p0 })) };
}
