// Anchors (FR-ANC-001, FR-ANC-002): where a connector end attaches to an element, in screen
// coordinates, with the direction the route leaves along. A floating anchor casts a ray from the
// element's centre toward the other end and lands on its outline (core's projectToOutline); a named
// anchor is a fraction of the element's box, from the instance's anchors, then the definition's, then
// the default set (n, e, s, w, center). Side and point anchors are fractions of the box too; `auto`
// floats until the anchor choice of FR-ANC-004 (M16). Everything is computed in the element's own
// box and mapped through its placement, so an anchor follows every move, resize, rotation and flip.
import { evaluateOutline, projectToOutline, type ShapeDef } from '@fluxion/core';
import { apply, elementMatrix, invert, type Mat2d, normalize, type Ok, type Path, pathFromCommands, sub, type Vec2 } from '@fluxion/geometry';
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

/** The floating anchor: the outline point on the ray from the element's centre toward `toward`. */
function floating(target: AnchorTarget, toward: Vec2): ResolvedAnchor {
  const { transform: t } = target;
  const m = matrixOf(t);
  // a placement is a rotation, flips and a translation (the size only moves the centre): always invertible
  const back = (invert(m) as Ok<Mat2d>).value;
  const centre = { x: t.w / 2, y: t.h / 2 };
  const dir = sub(apply(back, toward), centre);
  const local = projectToOutline(target.outline ?? boxOutline(t.w, t.h), centre, dir) ?? centre;
  const point = apply(m, local);
  return { point, dir: screenDir(m, dir) };
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
      return anchor === undefined ? floating(target, toward) : atFraction(target, anchor, anchor.dir);
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
  const outline = def === undefined ? undefined : evaluateOutline(def, { w: transform.w, h: transform.h }, element.params ?? {});
  return {
    transform,
    outline: outline?.ok === true ? outline.value.path : undefined,
    anchors: [...(element.anchors ?? []), ...(def?.anchors ?? [])],
  };
}
