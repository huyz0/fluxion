// Anchors (FR-ANC-001, FR-ANC-002): where a connector end attaches to an element, in screen
// coordinates, with the direction the route leaves along. A floating anchor casts a ray from the
// element's centre toward the other end and lands on its outline (core's projectToOutline); a named
// anchor is a fraction of the element's box, from the instance's anchors, then the definition's, then
// the default set (n, e, s, w, center); an anchor def resolves by its kind (ADR-0043, FR-ANC-003): fixed, side,
// center or perimeter. Side and point anchors are fractions of the box too; `auto`
// floats until the anchor choice of FR-ANC-004 (M16). Everything is computed in the element's own
// box and mapped through its placement, so an anchor follows every move, resize, rotation and flip.
import { evaluateOutline, projectToOutline, type ShapeDef } from '@fluxion/core';
import {
  apply,
  createPathSampler,
  elementMatrix,
  invert,
  type Mat2d,
  normalize,
  type Ok,
  type Path,
  pathFromCommands,
  sub,
  type Vec2,
} from '@fluxion/geometry';
import { type AnchorDef, type AnchorRef, type Transform, transformRotation } from '@fluxion/schema';

/**
 * What a connector end attaches to: the element's placement, its outline in its own box (none: the
 * box itself) and its named anchors, first match wins.
 *
 * @public
 */
export type AnchorTarget = {
  /** Placement on screen. */
  readonly transform: Transform;
  /** Outline in the element's own box (0..w, 0..h); the box when absent. */
  readonly outline?: Path | undefined;
  /** Named anchors, searched in order. */
  readonly anchors: readonly AnchorDef[];
};

/**
 * A resolved anchor, in screen coordinates.
 *
 * @public
 */
export type ResolvedAnchor = {
  /** Where the end attaches. */
  readonly point: Vec2;
  /** Unit direction a route leaves along; absent when the anchor has none (a centre). */
  readonly dir?: Vec2 | undefined;
};

/**
 * The anchors every element has unless it names its own with the same name: the side midpoints
 * `n`, `e`, `s`, `w` (pointing outward) and `center`.
 *
 * @public
 */
export const DEFAULT_ANCHORS: readonly AnchorDef[] = [
  { name: 'n', x: 0.5, y: 0, dir: { x: 0, y: -1 } },
  { name: 'e', x: 1, y: 0.5, dir: { x: 1, y: 0 } },
  { name: 's', x: 0.5, y: 1, dir: { x: 0, y: 1 } },
  { name: 'w', x: 0, y: 0.5, dir: { x: -1, y: 0 } },
  { name: 'center', x: 0.5, y: 0.5 },
];

/** Outward directions of the box sides. */
const SIDES = {
  n: { at: (t: number) => ({ x: t, y: 0 }), dir: { x: 0, y: -1 } },
  e: { at: (t: number) => ({ x: 1, y: t }), dir: { x: 1, y: 0 } },
  s: { at: (t: number) => ({ x: t, y: 1 }), dir: { x: 0, y: 1 } },
  w: { at: (t: number) => ({ x: 0, y: t }), dir: { x: -1, y: 0 } },
} as const;

const matrixOf = (t: Transform): Mat2d => elementMatrix({ ...t, rot: transformRotation(t) });

/** The box `w` x `h` as a closed outline. */
function boxOutline(w: number, h: number): Path {
  // finite corners after a move: a valid path
  const box = pathFromCommands([
    { kind: 'M', to: { x: 0, y: 0 } },
    { kind: 'L', to: { x: w, y: 0 } },
    { kind: 'L', to: { x: w, y: h } },
    { kind: 'L', to: { x: 0, y: h } },
    { kind: 'Z' },
  ]) as Ok<Path>;
  return box.value;
}

/** A direction in the element's own box mapped to screen (the matrix without its translation), unit length. */
function screenDir(m: Mat2d, dir: Vec2): Vec2 | undefined {
  const d = sub(apply(m, dir), apply(m, { x: 0, y: 0 }));
  return Math.hypot(d.x, d.y) > 0 ? normalize(d) : undefined;
}

/** The fraction (`x`, `y` of the box) mapped to screen, leaving along `dir` (in the box's frame). */
function atFraction(target: AnchorTarget, f: Vec2, dir: Vec2 | undefined): ResolvedAnchor {
  const { transform: t } = target;
  const m = matrixOf(t);
  return { point: apply(m, { x: f.x * t.w, y: f.y * t.h }), dir: dir === undefined ? undefined : screenDir(m, dir) };
}

/**
 * Where the ray from the centre of the box `w` x `h` along `dir` leaves it, in closed form; undefined for a
 * degenerate box or direction, which the outline projection decides (the hot path of a drag: no path is built).
 */
function boxExit(w: number, h: number, dir: Vec2): Vec2 | undefined {
  const length = Math.hypot(dir.x, dir.y);
  if (!(length > 0) || !(w > 0) || !(h > 0) || !Number.isFinite(length)) return undefined;
  const reach = Math.min(dir.x === 0 ? Infinity : w / 2 / Math.abs(dir.x), dir.y === 0 ? Infinity : h / 2 / Math.abs(dir.y));
  return { x: w / 2 + dir.x * reach, y: h / 2 + dir.y * reach };
}

/** Whether `a` and `b` are the same number to within rounding. */
const same = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;

/** Whether `outline` is exactly the rectangle `w` x `h` drawn with straight sides (a `rect` shape): its exit is then closed-form. */
function isBox(outline: Path, w: number, h: number): boolean {
  const corners = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ] as const;
  const { segments } = outline;
  return (
    outline.closed &&
    segments.length === 4 &&
    segments.every((seg) => {
      const straight = (key: 'x' | 'y') => same(seg.p0[key], seg.p1[key]) && same(seg.p0[key], seg.p2[key]) && same(seg.p0[key], seg.p3[key]);
      const onCorner = (p: Vec2) => corners.some(([cx, cy]) => same(p.x, cx) && same(p.y, cy));
      // a side keeps one coordinate, so it runs along the box edge between two corners
      return straight('x') !== straight('y') && onCorner(seg.p0) && onCorner(seg.p3);
    })
  );
}

/** The floating anchor: the outline point on the ray from the element's centre toward `toward`. */
function floating(target: AnchorTarget, toward: Vec2): ResolvedAnchor {
  const { transform: t } = target;
  const m = matrixOf(t);
  // a placement is a rotation, flips and a translation (the size only moves the centre): always invertible
  const back = (invert(m) as Ok<Mat2d>).value;
  const centre = { x: t.w / 2, y: t.h / 2 };
  const dir = sub(apply(back, toward), centre);
  const plain = target.outline === undefined || isBox(target.outline, t.w, t.h);
  const local = (plain ? boxExit(t.w, t.h, dir) : undefined) ?? projectToOutline(target.outline ?? boxOutline(t.w, t.h), centre, dir) ?? centre;
  const point = apply(m, local);
  return { point, dir: screenDir(m, dir) };
}

/** The center anchor: the box centre, leaving toward `toward` (none when the other end is at the centre). */
function centre(target: AnchorTarget, toward: Vec2, declared: Vec2 | undefined): ResolvedAnchor {
  const { transform: t } = target;
  const m = matrixOf(t);
  const back = (invert(m) as Ok<Mat2d>).value;
  const c = { x: t.w / 2, y: t.h / 2 };
  const dir = declared ?? sub(apply(back, toward), c);
  return { point: apply(m, c), dir: screenDir(m, dir) };
}

/** The perimeter anchor pinned at fraction `f` of the outline's length, leaving along the outline's normal that faces away from the centre. */
function atOutlineFraction(target: AnchorTarget, f: number, declared: Vec2 | undefined): ResolvedAnchor {
  const { transform: t } = target;
  const m = matrixOf(t);
  const sampler = createPathSampler(target.outline ?? boxOutline(t.w, t.h));
  const local = sampler.pointAtFraction(f);
  const centreOut = sub(local, { x: t.w / 2, y: t.h / 2 });
  const tangent = sampler.tangentAtLength(Math.min(Math.max(f, 0), 1) * sampler.length);
  // the normal of the outline, turned to face away from the centre; the centre's direction where the outline has no tangent
  const normal = { x: tangent.y, y: -tangent.x };
  const away = normal.x * centreOut.x + normal.y * centreOut.y >= 0 ? normal : { x: -normal.x, y: -normal.y };
  const dir = declared ?? (Math.hypot(normal.x, normal.y) > 0 ? away : centreOut);
  return { point: apply(m, local), dir: screenDir(m, dir) };
}

/** An anchor def resolved by its kind (default `fixed`); one that lacks what its kind needs floats. */
function resolveDef(target: AnchorTarget, def: AnchorDef, toward: Vec2): ResolvedAnchor {
  switch (
    def.kind // kind-switch-allow: anchor kinds are a closed union of the schema, not element kinds
  ) {
    case 'side': {
      if (def.side === undefined) return floating(target, toward);
      const side = SIDES[def.side];
      return atFraction(target, side.at(def.t ?? 0.5), def.dir ?? side.dir);
    }
    case 'center':
      return centre(target, toward, def.dir);
    case 'perimeter':
      return def.t === undefined ? floating(target, toward) : atOutlineFraction(target, def.t, def.dir);
    default:
      return def.x === undefined || def.y === undefined ? floating(target, toward) : atFraction(target, { x: def.x, y: def.y }, def.dir);
  }
}

/**
 * Where the end anchored by `ref` attaches to `target`, the route's other end being toward `toward`
 * (screen coordinates). An unknown anchor name floats.
 *
 * @public
 */
export function resolveAnchor(target: AnchorTarget, ref: AnchorRef, toward: Vec2): ResolvedAnchor {
  switch (
    ref.kind // kind-switch-allow: anchor intents are a closed union of the schema, not element kinds
  ) {
    case 'named': {
      const anchor = [...target.anchors, ...DEFAULT_ANCHORS].find((a) => a.name === ref.name);
      return anchor === undefined ? floating(target, toward) : resolveDef(target, anchor, toward);
    }
    case 'side': {
      const side = SIDES[ref.side];
      return atFraction(target, side.at(ref.t ?? 0.5), side.dir);
    }
    case 'point':
      return atFraction(target, ref, undefined);
    default:
      return floating(target, toward);
  }
}

/** Outlines evaluated for a definition, by size and params: a drag routes every connector of a shape against the same outline, and evaluating one parses its template. */
const outlines = new WeakMap<ShapeDef, Map<string, Path | undefined>>();

/** Most outlines kept per definition: a resize walks through many sizes, which would otherwise pile up. */
const OUTLINES_PER_DEF = 64;

/** The outline of `def` at `size` with `params` (undefined when it does not evaluate), evaluated once per distinct size and params. */
function outlineOf(def: ShapeDef, size: { readonly w: number; readonly h: number }, params: { readonly [key: string]: unknown }): Path | undefined {
  const kept = outlines.get(def) ?? new Map<string, Path | undefined>();
  outlines.set(def, kept);
  const key = `${size.w}x${size.h}:${JSON.stringify(params)}`;
  if (kept.has(key)) return kept.get(key);
  const evaluated = evaluateOutline(def, size, params);
  const outline = evaluated.ok ? evaluated.value.path : undefined;
  if (kept.size >= OUTLINES_PER_DEF) kept.clear();
  kept.set(key, outline);
  return outline;
}

/**
 * The anchor target of a shape of definition `def` (none: its box) placed at `transform` with
 * `params` and instance `anchors`: the definition's outline for its size, and the instance's anchors
 * before the definition's. An outline that does not evaluate falls back to the box.
 *
 * @public
 */
export function shapeAnchorTarget(
  transform: Transform,
  def: ShapeDef | undefined,
  element: { readonly params?: { readonly [key: string]: unknown } | undefined; readonly anchors?: readonly AnchorDef[] | undefined } = {},
): AnchorTarget {
  return {
    transform,
    outline: def === undefined ? undefined : outlineOf(def, { w: transform.w, h: transform.h }, element.params ?? {}),
    anchors: [...(element.anchors ?? []), ...(def?.anchors ?? [])],
  };
}
