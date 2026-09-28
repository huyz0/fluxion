// Public entry of @fluxion/theme; the package comment is the dts banner in tsdown.config.ts.

export type { ThemeError, ThemeErrorCode } from './errors.js';
export { LIGHT_THEME } from './light.js';
export { cssValue, resolveToken, toCssVars, tokenPath } from './resolve.js';
export { cssVarName, type Dimension, isToken, type Theme, type Token, type TokenGroup, type TypedToken, themeSchema } from './tokens.js';

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';
