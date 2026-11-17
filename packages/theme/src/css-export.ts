// The CSS-variable export of a theme (FR-THM-009, ADR-0055): the runtime's own emission (`toCssVars`) as a stylesheet, so the
// studio and an exported file agree. Editor/CLI path only.

import { toCssVars } from './resolve.js';
import type { Theme } from './tokens.js';

/**
 * Options of {@link themeToCss}.
 *
 * @public
 */
export type ThemeCssOptions = {
  /** The rule's selector (default `:root`). */
  readonly selector?: string;
};

/**
 * `theme`'s tokens as CSS custom properties (FR-THM-009, ADR-0055): a `/* theme: <name> *\/` comment, then one rule on
 * `options.selector` with one `--fx-<path>: <value>;` per valid token in tree order, two-space indent, LF line ends and a final
 * newline. Aliases and derived colours are their resolved literal (as `toCssVars` emits them); defaults and variants are not CSS.
 *
 * @example
 * ```ts
 * const css = themeToCss(LIGHT_THEME); // ":root {\n  --fx-color-primary: #2563eb;\n …"
 * ```
 * @public
 */
export function themeToCss(theme: Theme, options: ThemeCssOptions = {}): string {
  // the name may not close the comment, nor break the line
  const name = theme.name.replace(/\*\//g, '* /').replace(/[\r\n]+/g, ' ');
  const lines = Object.entries(toCssVars(theme)).map(([property, value]) => `  ${property}: ${value};`);
  return `/* theme: ${name} */\n${options.selector ?? ':root'} {\n${lines.join('\n')}\n}\n`;
}
