// Public entry of @fluxion/theme; the package comment is the dts banner in tsdown.config.ts.

export type { ResolvedEffect, ResolvedShadow } from './effects.js';
export type { ThemeError, ThemeErrorCode } from './errors.js';
export { LIGHT_THEME } from './light.js';
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
export { cssVarName, type Dimension, isToken, isValidToken, type Theme, type Token, type TokenGroup, type TypedToken, themeSchema } from './tokens.js';

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';
