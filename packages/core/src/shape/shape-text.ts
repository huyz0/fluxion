// A shape's text region and its fitted text (ADR-0018, FR-SHP-006): the region of the definition's
// first text region (numbers or expressions of the box's fractions) or the whole box; the text fitted
// in it; and, for `grow`, the element height the text needs.
import type { Box } from '@fluxion/geometry';
import type { Diagnostic, Result, Size, TextFit } from '@fluxion/schema';
import { err, ok } from '@fluxion/schema';
import { type ExprBudget, evaluateExpr, parseExpr } from '../expr/expr.js';
import type { FontSpec, TextMeasurer } from '../ports/ports.js';
import { type FittedText, fitText } from '../text/fit.js';
import { DEFAULT_OUTLINE_BUDGET, scopeOf } from './outline.js';
import type { ShapeDef } from './shape-def.js';

/** One field of a region as a fraction: a number as it is, an expression evaluated in `scope`. */
function fraction(value: number | string, scope: Parameters<typeof evaluateExpr>[1], budget: ExprBudget, at: (string | number)[]): Result<number, Diagnostic> {
  if (typeof value === 'number') return ok(value);
  const parsed = parseExpr(value, at);
  return parsed.ok ? evaluateExpr(parsed.value, scope, budget, { at, src: value }) : parsed;
}

/**
 * The text region of `def` for an element of `size` with `params`, in px of the element's box: its
 * first text region, else the whole box. Expressions spend `budget`; a failure is a diagnostic.
 *
 * @public
 */
export function textRegion(
  def: ShapeDef,
  size: Size,
  params: { readonly [key: string]: unknown } = {},
  budget: ExprBudget = { steps: DEFAULT_OUTLINE_BUDGET },
): Result<Box, Diagnostic> {
  const region = def.textRegions?.[0];
  if (region === undefined) return ok({ x: 0, y: 0, w: size.w, h: size.h });
  const scope = scopeOf(def, size, params);
  const out: number[] = [];
  for (const axis of ['x', 'y', 'w', 'h'] as const) {
    const r = fraction(region[axis], scope, budget, ['textRegions', 0, axis]);
    if (!r.ok) return err(r.error);
    out.push(r.value);
  }
  const [x, y, w, h] = out as [number, number, number, number];
  return ok({ x: x * size.w, y: y * size.h, w: w * size.w, h: h * size.h });
}

/**
 * A shape's text fitted to its region.
 *
 * @public
 */
export type ShapeText = FittedText & {
  /** The region, in px of the element's box. */
  readonly region: Box;
  /** The element height the text needs (`grow`): the region scaled until the text fits, never below the current height. */
  readonly height: number;
};

/**
 * What to fit in a shape.
 *
 * @public
 */
export type ShapeTextInput = {
  /** The shape's definition. */
  readonly def: ShapeDef;
  /** The element's size. */
  readonly size: Size;
  /** The element's params. */
  readonly params?: { readonly [key: string]: unknown } | undefined;
  /** The text, one string per paragraph. */
  readonly paragraphs: readonly string[];
  /** The font at its styled size. */
  readonly font: FontSpec;
  /** The element's fit settings. */
  readonly fit?: TextFit | undefined;
};

/**
 * Fit a shape's text to its region (ADR-0018): the font size to draw at, the lines, and the element
 * height `grow` needs. Pure: applying the height is the caller's write.
 *
 * @public
 */
export function fitShapeText(input: ShapeTextInput, measurer: TextMeasurer): Result<ShapeText, Diagnostic> {
  const region = textRegion(input.def, input.size, input.params);
  if (!region.ok) return region;
  const fitted = fitText({ paragraphs: input.paragraphs, font: input.font, region: region.value, fit: input.fit }, measurer);
  // the region's share of the box's height, from its fractions (the region of a box 1 px tall), so a
  // flat box grows by the right factor too (M5.33 review F1)
  const unit = textRegion(input.def, { w: input.size.w, h: 1 }, input.params);
  const share = unit.ok ? unit.value.h : 0;
  const needed = share > 0 ? fitted.regionHeight / share : input.size.h;
  return ok({ ...fitted, region: region.value, height: Math.max(input.size.h, needed) });
}
