// Text fitted to a region (ADR-0018 item 3, FR-SHP-006): at its size (`none`, `grow`) or at the largest
// size down to a minimum whose lines fit the padded region (`shrink`). `grow` reports the region height
// the text needs; applying it to an element is the caller's write (a view never writes).
import type { TextFit } from '@fluxion/schema';
import type { FontSpec, TextMeasurer } from '../ports/ports.js';
import { type StyledBlock, wrapStyled } from './styled.js';
import { type WrappedText, wrapText } from './wrap.js';

/**
 * The defaults of a shape's `textFit` (ADR-0018 item 1).
 *
 * @public
 */
export const TEXT_FIT_DEFAULTS: {
  /** The text keeps its size. */
  readonly mode: 'none';
  /** Space around the text inside its region, in px. */
  readonly padding: number;
  /** The smallest size `shrink` goes to, in px. */
  readonly minSize: number;
  /** Text that does not fit is drawn beyond the region. */
  readonly overflow: 'visible';
} = {
  mode: 'none',
  padding: 8,
  minSize: 8,
  overflow: 'visible',
};

/**
 * Whether `fit` shrinks its text to the region (so a view must measure it); `none` and `grow` draw the
 * text at its styled size.
 *
 * @public
 */
export function shrinksText(fit: TextFit | undefined): boolean {
  return (fit?.mode ?? TEXT_FIT_DEFAULTS.mode) === 'shrink';
}

/**
 * Text laid out in a region.
 *
 * @public
 */
export type FittedText = WrappedText & {
  /** The font size the text is drawn at, in px. */
  readonly size: number;
  /** The region height the text needs, padding included, in px. */
  readonly regionHeight: number;
};

/**
 * What to fit.
 *
 * @public
 */
export type FitInput = {
  /** The text, one string per paragraph. */
  readonly paragraphs: readonly string[];
  /**
   * The text as it is drawn (runs with their own sizes, headings, spacing, list indent); when given it is
   * laid out instead of `paragraphs`, whose lines only say whether there is text.
   */
  readonly blocks?: readonly StyledBlock[] | undefined;
  /** The font at its styled size. */
  readonly font: FontSpec;
  /** The region's size, in px. */
  readonly region: {
    /** Width. */
    readonly w: number;
    /** Height. */
    readonly h: number;
  };
  /** The element's fit settings (defaults: {@link TEXT_FIT_DEFAULTS}). */
  readonly fit?: TextFit | undefined;
};

/** Halvings of the size interval: enough for a size within 1/2^12 of the best. */
const STEPS = 12;

/**
 * Lay `input.paragraphs` out in the region: `shrink` picks the largest size from the font's down to
 * `minSize` whose lines fit the padded region (the minimum when none does); `none` and `grow` keep the
 * font's size.
 *
 * @public
 */
export function fitText(input: FitInput, measurer: TextMeasurer): FittedText {
  const padding = input.fit?.padding ?? TEXT_FIT_DEFAULTS.padding;
  const inner = { w: Math.max(0, input.region.w - 2 * padding), h: Math.max(0, input.region.h - 2 * padding) };
  const at = (size: number): FittedText => {
    const font = { ...input.font, size };
    const wrapped =
      input.blocks === undefined ? wrapText(input.paragraphs, font, inner.w, measurer) : wrapStyled(input.blocks, font, measurer, { maxWidth: inner.w });
    return { ...wrapped, size, regionHeight: wrapped.height + 2 * padding };
  };
  const full = at(input.font.size);
  const minSize = Math.min(input.fit?.minSize ?? TEXT_FIT_DEFAULTS.minSize, input.font.size);
  const fits = (t: FittedText) => t.height <= inner.h && t.width <= inner.w;
  if (!shrinksText(input.fit) || fits(full)) return full;
  // the largest fitting size between the minimum and the font's, by bisection
  let [lo, hi] = [minSize, input.font.size];
  // tzap disable next-line EqualityOperator: one halving more is as valid an answer; the step count is a precision choice
  for (let k = 0; k < STEPS; k++) {
    const mid = (lo + hi) / 2;
    if (fits(at(mid))) lo = mid;
    else hi = mid;
  }
  return at(lo);
}
