// Token resolution and CSS-variable emission (FR-THM-001, 04 §2.3): a token reference `{color.primary}`
// names a path in the tree; `toCssVars` emits every token as `--fx-<path>`, so rendered content refers
// to `var(--fx-color-primary)` and a theme switch restyles without re-rendering.
import { err, ok, type Result, type TokenRef } from '@fluxion/schema';
import type { ThemeError } from './errors.js';
import { cssVarName, isToken, isValidToken, type Theme, type Token, type TokenGroup, tokenEntries } from './tokens.js';

/**
 * The dot path of a token reference: `{color.primary}` → `color.primary`.
 *
 * @public
 */
export const tokenPath = (ref: TokenRef): string => ref.slice(1, -1);

/** The node at `path` in `tokens` (a token, a group, or undefined). */
function nodeAt(tokens: TokenGroup, path: string): Token | TokenGroup | undefined {
  let node: Token | TokenGroup | undefined = tokens;
  for (const name of path.split('.')) {
    if (node === undefined || isToken(node) || !Object.hasOwn(node, name)) return undefined;
    node = node[name];
  }
  return node;
}

/** CSS generic family keywords: written bare; every other family name is a quoted string. */
const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'emoji',
  'math',
  'fangsong',
]);

/** A family name as CSS (package-internal): a generic keyword bare, any other name as a string with `\` and `"` escaped. */
export const familyCss = (name: string): string => (GENERIC_FAMILIES.has(name) ? name : `"${name.replace(/[\\"]/g, (c) => `\\${c}`)}"`);

/**
 * A token's value as CSS text: a colour as written (a validated CSS colour), a dimension with its
 * unit, a font family list with every non-generic name quoted and escaped (M4.9 review F2), a number
 * as written.
 *
 * @public
 */
export function cssValue(token: Token): string {
  switch (token.$type) {
    case 'dimension':
      return `${token.$value.value}${token.$value.unit}`;
    case 'fontFamily':
      return (typeof token.$value === 'string' ? [token.$value] : token.$value).map(familyCss).join(', ');
    case 'color':
      return token.$value;
    default:
      return String(token.$value);
  }
}

/**
 * The token a reference names in `theme`, or why there is none (TOKEN_UNKNOWN; TOKEN_NOT_A_VALUE for a
 * group).
 *
 * @public
 */
export function resolveToken(theme: Theme, ref: TokenRef): Result<Token, ThemeError> {
  const path = tokenPath(ref);
  const node = nodeAt(theme.tokens, path);
  if (node === undefined) return err({ code: 'TOKEN_UNKNOWN', message: `theme ${theme.name} has no token ${ref}` });
  if (!isToken(node)) return err({ code: 'TOKEN_NOT_A_VALUE', message: `${ref} names a group of theme ${theme.name}, not a token` });
  return ok(node);
}

/**
 * Every valid token of `theme` as a CSS custom property: `{ '--fx-color-primary': '#2563eb', … }`;
 * a token the model does not accept is left out.
 *
 * @public
 */
export function toCssVars(theme: Theme): Record<string, string> {
  // only valid tokens with name-only paths: an unparsed theme object cannot emit other CSS (M4.10 review)
  const safe = tokenEntries(theme.tokens).filter(([path, token]) => /^[A-Za-z0-9_.-]+$/.test(path) && isValidToken(token));
  return Object.fromEntries(safe.map(([path, token]) => [cssVarName(path), cssValue(token)]));
}
