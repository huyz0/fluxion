// Parametric handles (FR-SHP-003, ADR-0016 item 4): a shape definition's `handles` bind a drag handle, placed by
// two expressions in the element's box, to a number or int param. `shapeHandles` says where they are for an
// element; `handleValue` is the other way round, the param value that puts a handle nearest a pointer, so a
// drag sets the param. The expressions are not invertible in general, so the value is searched for: sampled
// across the param's range, then refined between the best sample's neighbours.
import type { Vec2 } from '@fluxion/geometry';
import type { Size } from '@fluxion/schema';
import { runExpr } from '../expr/expr.js';
import { DEFAULT_OUTLINE_BUDGET, scopeOf } from './outline.js';
import type { NumberParam, ShapeDef } from './shape-def.js';

/**
 * A handle of an element, placed.
 *
 * @public
 */
export type ParamHandle = {
  /** The handle's index in the definition's `handles`. */
  readonly index: number;
  /** The param it edits. */
  readonly param: string;
  /** Where it is, in px of the element's box. */
  readonly at: Vec2;
};

/**
 * The shape element handles are placed on: its definition, size and params.
 *
 * @public
 */
export type HandleSubject = {
  /** The shape's definition. */
  readonly def: ShapeDef;
  /** The element's size. */
  readonly size: Size;
  /** The element's params (its own values; the definition's defaults for the rest). */
  readonly params?: { readonly [key: string]: unknown } | undefined;
};

/** The handle `index` of `def` at `value` of its param (the element's own when undefined); undefined when an expression fails. */
function placed(subject: HandleSubject, index: number, value?: number): Vec2 | undefined {
  const { def, size, params = {} } = subject;
  const handle = def.handles?.[index];
  if (handle === undefined) return undefined;
  const scope = scopeOf(def, size, value === undefined ? params : { ...params, [handle.param]: value });
  // tzap disable next-line ArrayDeclaration,StringLiteral: the path only names the expression in a diagnostic that is dropped
  const [x, y] = [handle.x, handle.y].map((src) => runExpr(src, scope, { steps: DEFAULT_OUTLINE_BUDGET }, ['handles', index]));
  return x?.ok === true && y?.ok === true ? { x: x.value, y: y.value } : undefined;
}

/**
 * The handles of `def` for an element of `size` with `params`, in definition order; one whose expressions do
 * not evaluate is left out.
 *
 * @public
 */
export function shapeHandles(subject: HandleSubject): readonly ParamHandle[] {
  return (subject.def.handles ?? []).flatMap((h, index) => {
    const at = placed(subject, index);
    return at === undefined ? [] : [{ index, param: h.param, at }];
  });
}

/** Samples across the range before refining. */
const SAMPLES = 48;
/** Golden-section steps between the best sample's neighbours: the interval shrinks by 0.618 each. */
const REFINE = 40;
const GOLDEN = (Math.sqrt(5) - 1) / 2;

/** The range of values `handleValue` searches: the param's own, or from 0 up to a few times its default or the box. */
function rangeOf(spec: NumberParam, size: Size): readonly [number, number] {
  return [spec.min ?? Math.min(0, spec.default), spec.max ?? Math.max(spec.default * 4, size.w, size.h)];
}

/**
 * The value of the handle's param that puts the handle nearest `target` (px in the element's box): what a
 * drag to `target` sets. An `int` param is whole, a `number` is rounded to a thousandth. Undefined when the
 * handle is not there, names no number param, or its expressions fail everywhere in the range.
 *
 * @public
 */
export function handleValue(subject: HandleSubject, index: number, target: Vec2): number | undefined {
  const { def, size } = subject;
  const handle = def.handles?.[index];
  const spec = handle === undefined ? undefined : def.params?.[handle.param];
  if (spec === undefined || (spec.type !== 'number' && spec.type !== 'int')) return undefined;
  const [lo, hi] = rangeOf(spec, size);
  const away = (v: number): number => {
    const at = placed(subject, index, v);
    return at === undefined ? Number.POSITIVE_INFINITY : (at.x - target.x) ** 2 + (at.y - target.y) ** 2;
  };
  const at = (k: number) => lo + ((hi - lo) * k) / SAMPLES;
  const costs = Array.from({ length: SAMPLES + 1 }, (_, k) => away(at(k)));
  const best = costs.indexOf(Math.min(...costs));
  if (costs[best] === Number.POSITIVE_INFINITY) return undefined;
  let [a, b] = [at(Math.max(0, best - 1)), at(Math.min(SAMPLES, best + 1))];
  // tzap disable next-line EqualityOperator,UpdateOperator: one halving more is as valid an answer (REFINE is a precision choice); a counter that falls never ends, which the run reports as a timeout
  for (let i = 0; i < REFINE; i++) {
    const [c, d] = [b - GOLDEN * (b - a), a + GOLDEN * (b - a)];
    // a tie goes to the lower side: on a plateau (a radius capped by the box) the drag sets the least value that reaches it
    if (away(c) <= away(d)) b = d;
    else a = c;
  }
  const found = (a + b) / 2;
  if (spec.type === 'number') return Math.round(found * 1000) / 1000;
  return Math.round(found);
}
