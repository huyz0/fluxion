// The model's rules for tokens and themes as plain checks (FR-THM-001, NFR-SEC-001): the same rules `themeSchema` states with Zod, for the readers that ship no
// validator (the one-file player's, ADR-0026) and for the emitters, which check a token before it reaches a style. A property test holds the two to each other.
import { isCssColor } from '@fluxion/schema';
import type { Theme, Token, TokenGroup } from './token-types.js';

const NAME = /^[A-Za-z0-9_-]+$/;
/** A font family name has no control characters, "<" or ">": it reaches CSS quoted and escaped, and markup could still end a style element or an attribute. */
export const FAMILY: RegExp = /^[^\p{Cc}<>]+$/u;
/** An alias to another token: names only, so it can never carry other CSS (it is resolved, never emitted as written). */
const ALIAS = /^\{[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*\}$/;

type Obj = { readonly [key: string]: unknown };
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const family = (v: unknown): boolean => typeof v === 'string' && FAMILY.test(v);
const inUnit = (v: unknown): boolean => typeof v === 'number' && v >= 0 && v <= 1;
const colour = (v: unknown): boolean => typeof v === 'string' && isCssColor(v);

/** What every token may carry besides its value: a description and extensions. */
const described = (t: Obj): boolean =>
  (t['$description'] === undefined || typeof t['$description'] === 'string') && (t['$extensions'] === undefined || isObj(t['$extensions']));

/** The rule for the `$value` of each token `$type`. */
const VALUE: { readonly [type: string]: (value: unknown) => boolean } = {
  color: (v) => colour(v) || (typeof v === 'string' && ALIAS.test(v)),
  dimension: (v) => isObj(v) && finite(v['value']) && v['unit'] === 'px',
  fontFamily: (v) => family(v) || (Array.isArray(v) && v.length >= 1 && v.every(family)),
  fontWeight: (v) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1 && v <= 1000,
  number: finite,
  shadow: (v) => isObj(v) && colour(v['color']) && finite(v['offsetX']) && finite(v['offsetY']) && finite(v['blur']) && v['blur'] >= 0 && finite(v['spread']),
  duration: (v) => isObj(v) && finite(v['value']) && v['value'] >= 0 && v['unit'] === 'ms',
  // x of each control point is in [0, 1] (CSS cubic-bezier)
  cubicBezier: (v) => Array.isArray(v) && v.length === 4 && v.every(finite) && inUnit(v[0]) && inUnit(v[2]),
};

/**
 * Whether `token` is a valid token of the model. Emitters check it, so a theme object that never went through `themeSchema` cannot put other CSS into their output.
 *
 * @public
 */
export function isValidToken(token: unknown): token is Token {
  if (!isObj(token) || typeof token['$type'] !== 'string' || !Object.hasOwn(VALUE, token['$type'])) return false;
  return described(token) && (VALUE[token['$type']] as (value: unknown) => boolean)(token['$value']);
}

const isTokenLike = (v: unknown): boolean => typeof v === 'object' && v !== null && '$value' in v;

/** Whether `node` is a group of valid tokens and groups, named by letters, digits, "_" and "-". */
function isValidGroup(node: unknown): node is TokenGroup {
  if (!isObj(node)) return false;
  return Object.entries(node).every(([name, v]) => NAME.test(name) && (isTokenLike(v) ? isValidToken(v) : isValidGroup(v)));
}

/** The dot paths of the tokens of `group`, in tree order. */
function paths(group: TokenGroup, prefix = ''): string[] {
  return Object.entries(group).flatMap(([name, node]) => {
    const path = prefix ? `${prefix}.${name}` : name;
    if (isTokenLike(node)) return [path];
    return typeof node === 'object' && node !== null ? paths(node as TokenGroup, path) : [];
  });
}

/** Whether two token paths name one CSS property (`a.b-c` and `a-b.c` are both `--fx-a-b-c`). */
const collides = (group: TokenGroup): boolean => new Set(paths(group).map((p) => p.split('.').join('-'))).size !== paths(group).length;

/**
 * The theme `value` is, read as `themeSchema` reads it (a name, a token tree, per-kind default styles; no two tokens on one CSS property), or nothing when it
 * is not a theme. Never throws.
 *
 * @public
 */
export function themeOf(value: unknown): Theme | undefined {
  if (!isObj(value) || typeof value['name'] !== 'string' || value['name'] === '' || !isValidGroup(value['tokens']) || collides(value['tokens']))
    return undefined;
  const defaults = value['defaults'];
  if (defaults !== undefined && !(isObj(defaults) && Object.values(defaults).every(isObj))) return undefined;
  return { name: value['name'], tokens: value['tokens'], ...(defaults === undefined ? {} : { defaults: defaults as Theme['defaults'] }) } as Theme;
}
