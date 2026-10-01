// Resolved CSS values as numbers and text (FR-TXT-002): `var(--fx-…)` references replaced by a theme's values,
// for measuring. No React, no DOM: the layout (rich-layout.ts) and the measurer share them.
import { type Theme, toCssVars } from '@fluxion/theme';

/**
 * `css` with its `var(--fx-…)` references replaced by `theme`'s values (unknown ones by nothing).
 *
 * @public
 */
export function substitute(css: string, theme: Theme): string {
  const vars = toCssVars(theme) as { readonly [name: string]: string | undefined };
  return css.replace(/var\((--[\w-]+)\)/g, (_, name: string) => vars[name] ?? '');
}

/**
 * A resolved length (`4px`, `var(--fx-radius-md)`) as a number of px with `theme`'s values; 0 when it
 * is none.
 *
 * @public
 */
export function concreteLength(css: string, theme: Theme): number {
  const n = Number.parseFloat(substitute(css, theme));
  return Number.isFinite(n) ? n : 0;
}
