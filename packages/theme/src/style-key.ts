// What of a theme its views depend on (04 §2.3, ADR-0015 amendment of M5.13): colour values reach
// views as CSS variables, so a change of colours alone restyles without re-rendering them; anything
// else (the defaults, token paths, types and validity, and every value that is not a colour: sizes,
// fonts, numbers a view may measure with) changes this key and re-renders them.
import { isValidToken, type Theme, tokenEntries } from './tokens.js';

/**
 * What views depend on in `theme`, apart from colour values. Two themes with the same key resolve
 * every style to the same CSS text and measure text the same way, so a view need not re-render
 * when only colours change (04 §2.3).
 *
 * @public
 */
export function styleKey(theme: Theme): string {
  const tokens = tokenEntries(theme.tokens).map(([path, token]) => [path, token.$type, isValidToken(token), token.$type === 'color' ? null : token.$value]);
  return JSON.stringify([theme.defaults ?? {}, tokens]);
}
