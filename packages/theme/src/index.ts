// Public entry of @fluxion/theme; the package comment is the dts banner in tsdown.config.ts.

export { type ColorResolver, colorResolver, followColor } from './alias.js';
export type { ResolvedEffect, ResolvedShadow } from './effects.js';
export type { ThemeError, ThemeErrorCode } from './errors.js';
export { LIGHT_THEME } from './light.js';
export {
  type ColorStep,
  contrastRatio,
  deriveOklch,
  type Oklch,
  oklchToCss,
  parseColor,
  relativeLuminance,
  rgbToOklch,
} from './oklch.js';
export { cssValue, resolveToken, toCssVars, tokenPath } from './resolve.js';
export {
  type NoPaint,
  type PaintResolution,
  type ResolvedColorPaint,
  type ResolvedFont,
  type ResolvedGradientPaint,
  type ResolvedImagePaint,
  type ResolvedPaint,
  type ResolvedStop,
  type ResolvedStroke,
  type ResolvedStyle,
  resolveBackground,
  resolveStyle,
  type StyleKind,
  type StyleResolution,
} from './resolve-style.js';
export { styleKey } from './style-key.js';
export {
  cssVarName,
  type Dimension,
  type Duration,
  isToken,
  isValidToken,
  type ShadowValue,
  type Theme,
  type Token,
  type TokenGroup,
  type TypedToken,
  themeSchema,
} from './tokens.js';
export { REQUIRED_COLOR_ROLES, type ThemeProblem, themeDiagnostics, validateTheme } from './validate-theme.js';

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';
