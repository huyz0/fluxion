// A definition's geometry across its parameter ranges and sizes (FR-LIB-007, FR-LIB-003, ADR-0194): the outline, decorations
// and handles stay in the box (each cubic at its exact extremes), and every text region has a nonnegative size inside it, for
// each number param's minimum, maximum and default, every enum value and every corner of the number-param box (M18.121), at
// the default size and at the smallest sizes the check resizes to; anchors are fractions of the box.
import { evaluateOutline, type ParamSpec, type ShapeDef, shapeHandles, textRegion } from '@fluxion/core';

/** How far a point may fall outside the box, in units: rounding only. */
const SLACK = 0.5;

/** The smallest side the check resizes a shape to, in units: a box this small still draws inside itself. */
export const MIN_CHECK_SIDE = 16;
/** Up to this many bounded number params, every corner of their box is checked; beyond it, every pair's corners (the rest at defaults). */
const ALL_CORNERS = 6;

type Point = { readonly x: number; readonly y: number };
type Size = { readonly w: number; readonly h: number };
type Variant = { readonly label: string; readonly params: Readonly<Record<string, unknown>> };

const round = (v: number): number => Math.round(v * 100) / 100;
const at = (p: Point): string => `(${round(p.x)}, ${round(p.y)})`;

/** The values of one param to evaluate besides its default, and why its range cannot be checked, if so. */
function paramValues(id: string, name: string, spec: ParamSpec): { readonly values: readonly (number | string)[]; readonly unbounded?: string } {
  if (spec.type === 'enum') return { values: spec.values };
  if (spec.type === 'points') return { values: [] };
  const values = [spec.min, spec.max].filter((v): v is number => v !== undefined);
  return values.length === 2 ? { values } : { values, unbounded: `${id}: param ${name} has no min or max, so its range cannot be checked` };
}

/** Every combination of the bounded number params at their bounds, or of each pair when there are too many (cp12 F5). */
function corners(bounded: readonly (readonly [string, number, number])[]): Readonly<Record<string, number>>[] {
  const combine = (params: readonly (readonly [string, number, number])[]): Record<string, number>[] =>
    params.reduce<Record<string, number>[]>(
      (acc, [name, min, max]) =>
        acc.flatMap((c) => [
          { ...c, [name]: min },
          { ...c, [name]: max },
        ]),
      [{}],
    );
  if (bounded.length < 2) return [];
  if (bounded.length <= ALL_CORNERS) return combine(bounded);
  return bounded.flatMap((a, i) => bounded.slice(i + 1).flatMap((b) => combine([a, b])));
}

/** The params to evaluate: all defaults, each number param at its bounds, each enum at every value, then the corners. */
function variants(def: ShapeDef): { readonly list: Variant[]; readonly unbounded: string[] } {
  const list: Variant[] = [{ label: 'defaults', params: {} }];
  const unbounded: string[] = [];
  const bounded: [string, number, number][] = [];
  for (const [name, spec] of Object.entries(def.params ?? {})) {
    const param = paramValues(def.id, name, spec);
    if (param.unbounded !== undefined) unbounded.push(param.unbounded);
    for (const value of param.values) list.push({ label: `${name}=${value}`, params: { [name]: value } });
    if (spec.type === 'number' && spec.min !== undefined && spec.max !== undefined) bounded.push([name, spec.min, spec.max]);
  }
  for (const params of corners(bounded))
    list.push({
      label: Object.entries(params)
        .map(([name, value]) => `${name}=${value}`)
        .join(','),
      params,
    });
  return { list, unbounded };
}

/** The sizes to evaluate: the default, then the smallest square and the default narrowed and flattened to the smallest side. */
function sizes(def: ShapeDef): Size[] {
  const { w, h } = def.defaultSize;
  const min = MIN_CHECK_SIDE;
  return [def.defaultSize, { w: min, h: min }, { w: min, h }, { w, h: min }];
}

type Cubic = { readonly p0: Point; readonly p1: Point; readonly p2: Point; readonly p3: Point };

/** The point at `t` along the cubic `s`. */
function cubicAt(s: Cubic, t: number): Point {
  const u = 1 - t;
  const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return { x: a * s.p0.x + b * s.p1.x + c * s.p2.x + d * s.p3.x, y: a * s.p0.y + b * s.p1.y + c * s.p2.y + d * s.p3.y };
}

/** The `t` in 0 … 1 where one coordinate of a cubic with those four values turns: the roots of its derivative. */
function turns(a: number, b: number, c: number, d: number): number[] {
  // B'(t)/3 = q t² + r t + s
  const [q, r, s] = [-a + 3 * b - 3 * c + d, 2 * (a - 2 * b + c), b - a];
  const roots = Math.abs(q) < 1e-12 ? (Math.abs(r) < 1e-12 ? [] : [-s / r]) : quadraticRoots(q, r, s);
  return roots.filter((t) => t > 0 && t < 1);
}

function quadraticRoots(q: number, r: number, s: number): number[] {
  const disc = r * r - 4 * q * s;
  if (disc < 0) return [];
  const root = Math.sqrt(disc);
  return [(-r + root) / (2 * q), (-r - root) / (2 * q)];
}

/** The ends and every extreme point of the cubic `s`: the curve stays within these on both axes. */
function extremes(s: Cubic): Point[] {
  const ts = [0, 1, ...turns(s.p0.x, s.p1.x, s.p2.x, s.p3.x), ...turns(s.p0.y, s.p1.y, s.p2.y, s.p3.y)];
  return ts.map((t) => cubicAt(s, t));
}

/** The problems of one variant at one size: outline or decorations, handles and text regions. */
function variantProblems(def: ShapeDef, variant: Variant, size: Size): string[] {
  const where = `${def.id} at ${variant.label}${size === def.defaultSize ? '' : ` ${size.w}x${size.h}`}`;
  const outside = (p: Point) => p.x < -SLACK || p.y < -SLACK || p.x > size.w + SLACK || p.y > size.h + SLACK;
  const outline = evaluateOutline(def, size, variant.params);
  if (!outline.ok) return [`${where}: outline does not evaluate: ${outline.error.message}`];
  const drawn = [outline.value.path, ...outline.value.decorations].flatMap((path) => path.segments.flatMap(extremes));
  const out: string[] = [];
  const leaving = drawn.find(outside);
  if (leaving) out.push(`${where}: draws outside its ${size.w}x${size.h} box at ${at(leaving)}`);
  const handles = shapeHandles({ def, size, params: variant.params });
  (def.handles ?? []).forEach((h, index) => {
    const placed = handles.find((p) => p.index === index);
    if (placed === undefined) out.push(`${where}: handle ${index} (${h.param}) does not evaluate`);
    else if (outside(placed.at)) out.push(`${where}: handle ${index} (${h.param}) leaves the box at ${at(placed.at)}`);
  });
  (def.textRegions ?? []).forEach((region, k) => {
    const box = textRegion({ ...def, textRegions: [region] }, size, variant.params);
    if (!box.ok) out.push(`${where}: text region ${region.name} does not evaluate: ${box.error.message}`);
    else if (box.value.w < 0 || box.value.h < 0)
      out.push(`${where}: text region ${region.name} has a negative size ${round(box.value.w)}x${round(box.value.h)}`);
    else if (outside(box.value) || outside({ x: box.value.x + box.value.w, y: box.value.y + box.value.h }))
      out.push(`${where}: text region ${k} (${region.name}) leaves the box`);
  });
  return out;
}

/** Every geometry problem of `def` across its parameter ranges, deduplicated, in evaluation order. */
export function geometryProblems(def: ShapeDef): string[] {
  const { list, unbounded } = variants(def);
  const fractionOutside = (v: number | undefined) => v !== undefined && (v < 0 || v > 1);
  const anchors = (def.anchors ?? [])
    .filter((a) => fractionOutside(a.x) || fractionOutside(a.y) || fractionOutside(a.t))
    .map((a) => `${def.id}: anchor ${a.name} is outside the box`);
  return [...new Set([...unbounded, ...anchors, ...sizes(def).flatMap((size) => list.flatMap((v) => variantProblems(def, v, size)))])];
}
