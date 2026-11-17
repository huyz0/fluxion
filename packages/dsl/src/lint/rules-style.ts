// The style rules (FR-AI-005, NFR-A11Y-005): CONTRAST, STYLE_LITERAL, STYLE_INCONSISTENT.
import { CONTRAST } from './contrast.js';
import { finding } from './rules-layout.js';
import type { LintFinding, LintRule } from './types.js';
import { screensOf } from './view.js';

/** The most font sizes, and font families, a screen may use before its styling reads as inconsistent. */
export const MAX_FONT_SIZES = 4;
export const MAX_FONT_FAMILIES = 2;

const LITERAL_COLOUR = /^(#[0-9a-fA-F]{3,8}|(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(.*\))$/i;

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
