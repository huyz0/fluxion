// The contrast linter's check (NFR-A11Y-005, ADR-0055): one colour against what it is drawn on, at the WCAG AA target for its
// kind (text 4.5:1; large text and strokes 3:1, the thresholds the palette generator uses), and the nearest colour that passes:
// same hue and chroma, the lightness nearest its own. Pure; the document rule (dsl's CONTRAST) and the editor's fix use it.

import { type Anchor, CONTRAST_GRAPHIC, CONTRAST_TEXT, solveLightness } from './contrast.js';
import { contrastRatio, oklchToCss, parseColor } from './oklch.js';

/**
 * What a contrast check measures: body `text`, `large-text` (24 px, or bold at 18.66 px, and up) or a `stroke` (a graphic object).
 *
 * @public
 */
export type ContrastKind = 'text' | 'large-text' | 'stroke';

/**
 * One colour to check against the colour it is drawn on.
 *
 * @public
 */
export type ContrastCheck = {
  /** What the colour is used for. */
  readonly kind: ContrastKind;
  /** The colour checked (a literal CSS colour). */
  readonly color: string;
  /** The colour behind it (a literal CSS colour). */
  readonly against: string;
};

/**
 * A check below its target, with the nearest colour that passes.
 *
 * @public
 */
export type ContrastIssue = ContrastCheck & {
  /** The ratio measured. */
  readonly ratio: number;
  /** The ratio its kind needs: {@link CONTRAST_TEXT} or {@link CONTRAST_GRAPHIC}. */
  readonly target: number;
  /** The nearest passing colour (`#rrggbb`): `color`'s hue and chroma at the lightness nearest its own that reaches `target`. */
  readonly fix: string;
};

/** Text at least this size (px) is large (WCAG: 18 pt). */
const LARGE_PX = 24;
/** Bold text at least this size (px) is large (WCAG: 14 pt bold). */
const LARGE_BOLD_PX = 18.66;

/**
 * The contrast kind of text of `size` px at `weight`: large at 24 px, or 18.66 px when bold (700 and up).
 *
 * @public
 */
export const textContrastKind = (size: number, weight: number): ContrastKind =>
  size >= LARGE_PX || (weight >= 700 && size >= LARGE_BOLD_PX) ? 'large-text' : 'text';

/**
 * The WCAG AA ratio a kind needs: 4.5 for text, 3 for large text and strokes.
 *
 * @public
 */
export const contrastTarget = (kind: ContrastKind): number => (kind === 'text' ? CONTRAST_TEXT : CONTRAST_GRAPHIC);

/**
 * The issue of `check` when its colours are below the target of its kind (NFR-A11Y-005), with the nearest passing colour; undefined
 * when it passes or a colour cannot be read (a gradient, `var()`, a named colour).
 *
 * @example
 * ```ts
 * checkContrast({ kind: 'text', color: '#888888', against: '#999999' })?.fix; // a darker grey that reaches 4.5:1
 * ```
 * @public
 */
export function checkContrast(check: ContrastCheck): ContrastIssue | undefined {
  const ratio = contrastRatio(check.color, check.against);
  const color = parseColor(check.color);
  const behind = parseColor(check.against);
  const target = contrastTarget(check.kind);
  if (ratio === undefined || color === undefined || behind === undefined || ratio >= target) return undefined;
  const anchor: Anchor = { hex: oklchToCss({ ...behind, alpha: 1 }), target };
  const solved = solveLightness({ ...color, alpha: 1 }, [anchor]);
  return { ...check, ratio, target, fix: solved.hex };
}
