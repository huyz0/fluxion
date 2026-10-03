// Following an alias (ADR-0152): a colour token whose value is `{path}` takes the colour of the token it names, which may
// itself be an alias. The chain is followed with a visited set, so a cycle is reported and never looped over. Pure.
import { err, ok, type Result } from '@fluxion/schema';
import type { ThemeError } from './errors.js';
import { isToken, isValidToken, nodeAt, type Theme, TOKEN_REF } from './tokens.js';

/** The longest alias chain followed: far more than any theme writes, and a bound on the work a hostile theme can ask for. */
const MAX_CHAIN = 64;

/**
 * The literal colour the colour token at `path` resolves to, following aliases: TOKEN_UNKNOWN when a link names no token,
 * TOKEN_TYPE when one names a token that is not a colour, TOKEN_CYCLE when the chain returns to a token it has visited.
 *
 * @public
 */
export function followColor(theme: Theme, path: string): Result<string, ThemeError> {
  const seen: string[] = [];
  let at = path;
  for (let hops = 0; hops <= MAX_CHAIN; hops++) {
    if (seen.includes(at))
      return err({ code: 'TOKEN_CYCLE', message: `aliases of theme ${theme.name} return to {${at}}: ${[...seen, at].map((p) => `{${p}}`).join(' -> ')}` });
    seen.push(at);
    const node = nodeAt(theme.tokens, at);
    if (node === undefined) return err({ code: 'TOKEN_UNKNOWN', message: `theme ${theme.name} has no token {${at}}` });
    if (!isToken(node) || node.$type !== 'color') return err({ code: 'TOKEN_TYPE', message: `{${at}} of theme ${theme.name} is not a colour token` });
    // every link must be a valid colour token itself: a theme object that never went through `themeSchema` cannot make an
    // alias carry a string that is not a colour into CSS (M4.10 review round 2 F1)
    if (!isValidToken(node)) return err({ code: 'TOKEN_TYPE', message: `{${at}} of theme ${theme.name} is not a valid colour token` });
    if (!TOKEN_REF.test(node.$value)) return ok(node.$value);
    at = node.$value.slice(1, -1);
  }
  return err({ code: 'TOKEN_CYCLE', message: `the alias chain from {${path}} in theme ${theme.name} is longer than ${MAX_CHAIN}` });
}
