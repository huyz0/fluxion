// Public entry of @fluxion/theme; the package comment is the dts banner in tsdown.config.ts.

export { type ColorResolver, colorResolver, followColor } from './alias.js';
export {
  CONTRAST_GRAPHIC,
  CONTRAST_TEXT,
  type ContrastMiss,
  type ContrastPair,
  PALETTE_CONTRAST_PAIRS,
  type PaletteRole,
} from './contrast.js';
export { type ThemeCssOptions, themeToCss } from './css-export.js';
export {
  type DtcgImportOptions,
  type ExportedTheme,
  exportDtcg,
  type FileTheme,
  importDtcg,
  type ThemeFile,
  themeFileName,
  themesFromFiles,
} from './dtcg.js';
export type { DtcgWarning, DtcgWarningCode, ImportedTheme } from './dtcg-types.js';
export type { ResolvedEffect, ResolvedShadow } from './effects.js';
export type { ThemeError, ThemeErrorCode } from './errors.js';
export { FONT_MAX_BYTES, type FontFileInfo, type FontFormat, readFontFile } from './font-file.js';
export { createFontRegistry, type FontFaceDef, type FontFamilyInfo, type FontRegistry, type FontSource } from './fonts.js';
export { BUILTIN_TABLE_STYLES, LIGHT_THEME } from './light.js';
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
export { applyPalette, generatePalette, type Palette, type PaletteOptions } from './palette.js';
export { type PalettePixels, type PixelPaletteOptions, paletteFromPixels } from './palette-image.js';
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
export { themeOf } from './token-check.js';
export {
  cssVarName,
  type Dimension,
  type Duration,
  isToken,
  isValidToken,
  type ShadowValue,
  type Theme,
  type ThemeTableStyle,
  type Token,
  type TokenGroup,
  type TypedToken,
  themeSchema,
} from './tokens.js';
export { REQUIRED_COLOR_ROLES, type ThemeProblem, themeDiagnostics, validateTheme } from './validate-theme.js';
export { BUILTIN_VARIANTS } from './variants.js';

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';
