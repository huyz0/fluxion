// The style rules (FR-AI-005): CONTRAST, STYLE_LITERAL, STYLE_INCONSISTENT.
import type { Style } from '@fluxion/schema';
import { contrastRatio, resolveStyle, toCssVars } from '@fluxion/theme';
import { finding } from './rules-layout.js';
import type { LintContext, LintFinding, LintRule } from './types.js';
import { screensOf } from './view.js';

/** WCAG 2.2 minimum contrast of normal text (NFR-A11Y-005). */
export const CONTRAST_TEXT_MIN = 4.5;
/** WCAG 2.2 minimum contrast of large text. */
export const CONTRAST_LARGE_MIN = 3;
/** Text this size (px) or larger, or bold and 18.66 px or larger, is large. */
const LARGE_PX = 24;
const LARGE_BOLD_PX = 18.66;
/** The most font sizes, and font families, a screen may use before its styling reads as inconsistent. */
export const MAX_FONT_SIZES = 4;
export const MAX_FONT_FAMILIES = 2;

const VAR = /^var\((--[A-Za-z0-9_-]+)\)$/;
const LITERAL_COLOUR = /^(#[0-9a-fA-F]{3,8}|(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(.*\))$/i;

/** The literal colour behind a resolved CSS colour: a `var(--fx-…)` through the theme's variables, else the value itself. */
function literal(css: string, vars: { readonly [name: string]: string }): string {
  const name = VAR.exec(css)?.[1];
  return name === undefined ? css : (vars[name] ?? css);
}

/** The contrast finding of one element, if its resolved text and fill colours are known and too close. */
function contrastOf(
  style: Style | undefined,
  kind: string,
  ctx: Required<Pick<LintContext, 'theme'>>,
  vars: { readonly [name: string]: string },
): string | undefined {
  const { style: resolved } = resolveStyle(style, kind, ctx.theme);
  if (resolved.fill.type !== 'color') return undefined;
  const ratio = contrastRatio(literal(resolved.font.color, vars), literal(resolved.fill.css, vars));
  if (ratio === undefined) return undefined;
  const size = Number.parseFloat(resolved.font.size);
  const bold = Number.parseFloat(resolved.font.weight) >= 700;
  const min = size >= LARGE_PX || (bold && size >= LARGE_BOLD_PX) ? CONTRAST_LARGE_MIN : CONTRAST_TEXT_MIN;
  return ratio < min ? `${ratio.toFixed(2)}:1 (needs ${min}:1)` : undefined;
}

const CONTRAST: LintRule = {
  id: 'CONTRAST',
  code: 'FLX_LINT_CONTRAST',
  severity: 'warning',
  weight: 6,
  describe: 'text whose colour has too little contrast against its fill (WCAG 4.5:1, large text 3:1)',
  check(doc, ctx) {
    const theme = ctx.theme;
    if (!theme) return [];
    const vars = toCssVars(theme);
    return screensOf(doc).flatMap((screen) =>
      screen.elements.flatMap((e): LintFinding[] => {
        if (e.text === '') return [];
        const found = contrastOf(e.rec['style'] as Style | undefined, String(e.rec['kind']), { theme }, vars);
        return found === undefined
          ? []
          : [finding('FLX_LINT_CONTRAST', e.id, `the text of ${e.id} has contrast ${found}`, 'pick a text colour or a fill with more contrast')];
      }),
    );
  },
};

/** Every string value of `value` that is a literal colour, by path. */
function literalColours(value: unknown, path: readonly string[] = []): readonly string[] {
  if (typeof value === 'string') return LITERAL_COLOUR.test(value) ? [path.join('.')] : [];
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([k, v]) => literalColours(v, [...path, k]));
}

const STYLE_LITERAL: LintRule = {
  id: 'STYLE_LITERAL',
  code: 'FLX_LINT_STYLE_LITERAL',
  severity: 'warning',
  weight: 2,
  describe: 'a style writes a colour literal where a theme token would do',
  check(doc) {
    return screensOf(doc).flatMap((screen) =>
      screen.elements.flatMap((e): LintFinding[] => {
        const fields = literalColours(e.rec['style']);
        return fields.length === 0
          ? []
          : [finding('FLX_LINT_STYLE_LITERAL', e.id, `${e.id} writes a colour literal in ${fields.join(', ')}`, 'use a token such as {color.primary}')];
      }),
    );
  },
};

/** The distinct literal values of `font.<field>` over the elements of a screen. */
function distinct(styles: readonly unknown[], field: 'size' | 'family'): readonly unknown[] {
  const values = styles
    .map((s) => (s as { font?: { [k: string]: unknown } } | undefined)?.font?.[field])
    .filter((v) => typeof v === 'number' || (typeof v === 'string' && !v.startsWith('{')));
  return [...new Set(values)];
}

const STYLE_INCONSISTENT: LintRule = {
  id: 'STYLE_INCONSISTENT',
  code: 'FLX_LINT_STYLE_INCONSISTENT',
  severity: 'warning',
  weight: 3,
  describe: `a screen mixes more than ${MAX_FONT_SIZES} font sizes or ${MAX_FONT_FAMILIES} font families`,
  check(doc) {
    const out: LintFinding[] = [];
    for (const screen of screensOf(doc)) {
      const styles = screen.elements.map((e) => e.rec['style']);
      const sizes = distinct(styles, 'size');
      const families = distinct(styles, 'family');
      if (sizes.length > MAX_FONT_SIZES || families.length > MAX_FONT_FAMILIES)
        out.push(
          finding(
            'FLX_LINT_STYLE_INCONSISTENT',
            screen.id,
            `screen ${screen.id} uses ${sizes.length} font sizes and ${families.length} families`,
            'use one size scale and at most two families',
          ),
        );
    }
    return out;
  },
};

/** The style rules, in report order. */
export const STYLE_RULES: readonly LintRule[] = [CONTRAST, STYLE_LITERAL, STYLE_INCONSISTENT];
