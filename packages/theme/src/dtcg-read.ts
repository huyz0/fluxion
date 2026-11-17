// Reading a foreign DTCG file's tokens (FR-THM-009, ADR-0055 step 0, package-internal): every token in tree order with its group's
// `$type`, values decoded to the theme model (rem and s converted, weight names, colour objects or CSS text), non-colour aliases
// replaced by the literal they reach. What cannot be read is warned and left out. Editor/CLI path only.

import { colorText, isObject, type Json, withoutCss } from './dtcg-codec.js';
import type { DtcgWarningCode } from './dtcg-types.js';
import { isValidToken } from './token-check.js';
import { TOKEN_REF, type Token } from './tokens.js';

export type Warn = (code: DtcgWarningCode, path: string, message: string) => void;

/** A token and group name the token model takes. */
const NAME = /^[A-Za-z0-9_-]+$/;
/** The longest alias chain a non-colour token may follow (as the colour resolver's bound). */
export const MAX_CHAIN = 64;
/** DTCG types that have no token type here. */
const COMPOSITES = new Set(['typography', 'border', 'gradient', 'transition', 'strokeStyle']);

/** DTCG 2025.10 font-weight names and their aliases. */
const WEIGHTS: { readonly [name: string]: number } = {
  thin: 100,
  hairline: 100,
  'extra-light': 200,
  'ultra-light': 200,
  light: 300,
  normal: 400,
  regular: 400,
  book: 400,
  medium: 500,
  'semi-bold': 600,
  'demi-bold': 600,
  bold: 700,
  'extra-bold': 800,
  'ultra-bold': 800,
  black: 900,
  heavy: 900,
  'extra-black': 950,
  'ultra-black': 950,
};

export const joinPath = (path: readonly string[]): string => path.join('.');
export const isAlias = (v: unknown): v is string => typeof v === 'string' && TOKEN_REF.test(v);
export const aliasPath = (ref: string): string => ref.slice(1, -1);

/** Where a value is read, and where its warnings go. */
type Site = { readonly path: string; readonly warn: Warn };

/** A length in px from a DTCG dimension (`rem` × 16, warned), or undefined. */
function pxOf(v: unknown, site: Site): number | undefined {
  if (!isObject(v) || typeof v['value'] !== 'number' || !Number.isFinite(v['value'])) return undefined;
  if (v['unit'] === 'px') return v['value'];
  if (v['unit'] !== 'rem') return undefined;
  site.warn('DTCG_UNSUPPORTED', site.path, `${site.path}: a rem length is read as 16 px per rem`);
  return v['value'] * 16;
}

/** A DTCG shadow as the theme's shadow: one object, a literal colour, px or rem lengths (`null`: a list, warned). */
function shadowOf(v: unknown, css: string | undefined, site: Site): unknown {
  if (Array.isArray(v)) {
    site.warn('DTCG_UNSUPPORTED', site.path, `${site.path}: a list of shadows is not supported; the token is left out`);
    return null;
  }
  if (!isObject(v)) return undefined;
  if (v['inset'] === true) {
    site.warn('DTCG_UNSUPPORTED', site.path, `${site.path}: an inset shadow is not supported; the token is left out`);
    return null;
  }
  const color = css ?? colorText(v['color']);
  const [offsetX, offsetY, blur, spread] = [v['offsetX'], v['offsetY'], v['blur'], v['spread']].map((n) => pxOf(n, site));
  if (color === undefined || offsetX === undefined || offsetY === undefined || blur === undefined || spread === undefined) return undefined;
  return { color, offsetX, offsetY, blur, spread };
}

/** A DTCG duration in ms (`s` × 1000), or undefined. */
function msOf(v: unknown): unknown {
  if (!isObject(v) || typeof v['value'] !== 'number') return undefined;
  if (v['unit'] === 'ms') return { value: v['value'], unit: 'ms' };
  return v['unit'] === 's' ? { value: v['value'] * 1000, unit: 'ms' } : undefined;
}

/** A foreign token as it is read: its path, type and raw value, and the fields it keeps. */
export type Raw = {
  readonly path: string;
  readonly type: string;
  readonly value: unknown;
  readonly description: unknown;
  readonly ext: Json | undefined;
  readonly css: string | undefined;
};

/** The theme value of the literal of `source` (`null`: already warned and left out; undefined: not a value of its type). */
function literalOf(source: Raw, site: Site): unknown {
  const v = source.value;
  switch (source.type) {
    case 'color':
      // a colour object, or (as files before DTCG 2025.10 write it) CSS colour text, which the token check then validates
      return source.css ?? (typeof v === 'string' ? v : colorText(v));
    case 'dimension': {
      const n = pxOf(v, site);
      return n === undefined ? undefined : { value: n, unit: 'px' };
    }
    case 'duration':
      return msOf(v);
    case 'fontWeight':
      // the names exactly as DTCG lists them (a case variant is not one)
      return typeof v === 'string' ? WEIGHTS[v] : v;
    case 'shadow':
      return shadowOf(v, source.css, site);
    default:
      return v;
  }
}

/** The `$`-keys of a group that are read (`$type`) and those that are dropped, warned. */
function groupKeys(group: Json, path: string, warn: Warn): void {
  for (const key of Object.keys(group)) {
    if (!key.startsWith('$') || key === '$type') continue;
    const at = path === '' ? '(root)' : path;
    const what = key === '$root' ? 'a $root token' : key === '$deprecated' ? '$deprecated (ignored)' : `the group's ${key}`;
    warn('DTCG_UNSUPPORTED', at, `${at}: ${what} is not supported and is dropped`);
  }
}

/** One foreign token as read, its type the group's when it has none of its own; undefined (warned) when it has no type. */
function rawToken(node: Json, inherited: unknown, site: Site): Raw | undefined {
  const { path, warn } = site;
  for (const key of ['$deprecated', '$extends', '$ref']) if (key in node) warn('DTCG_UNSUPPORTED', path, `${path}: ${key} is not supported and is ignored`);
  // an untyped reference takes its target's type later (`typeReferences`); any other untyped token is invalid (DTCG 5.2.2)
  const type = typeof node['$type'] === 'string' ? node['$type'] : typeof inherited === 'string' ? inherited : isAlias(node['$value']) ? '' : undefined;
  if (type === undefined) {
    warn('DTCG_UNSUPPORTED', path, `${path}: a token with no $type is left out`);
    return undefined;
  }
  const { ext, css } = withoutCss(node['$extensions']);
  return { path, type, value: node['$value'], description: node['$description'], ext, css };
}

/** Where `collect` is in the tree: the group's path and the `$type` it passes down. */
type Walk = { readonly path: readonly string[]; readonly type: unknown };

/** Every token of a foreign tree in tree order, with group `$type` resolved onto it; what cannot be a token is warned and dropped. */
export function collect(group: Json, walk: Walk, warn: Warn): Raw[] {
  groupKeys(group, joinPath(walk.path), warn);
  const type = typeof group['$type'] === 'string' ? group['$type'] : walk.type;
  return Object.entries(group).flatMap(([name, node]): Raw[] => {
    if (name.startsWith('$')) return [];
    const path = joinPath([...walk.path, name]);
    if (!NAME.test(name) || !isObject(node)) {
      warn('DTCG_UNSUPPORTED', path, `${path}: not a token or group the theme model takes (names are letters, digits, "_" and "-")`);
      return [];
    }
    if (!('$value' in node)) return collect(node, { path: [...walk.path, name], type }, warn);
    const raw = rawToken(node, type, { path, warn });
    return raw === undefined ? [] : [raw];
  });
}

/** Untyped references with the type of the token their chain reaches (DTCG 5.2.2); one that reaches none is left out, warned. */
export function typeReferences(raws: readonly Raw[], warn: Warn): Raw[] {
  const byPath = new Map(raws.map((r) => [r.path, r]));
  return raws.flatMap((raw): Raw[] => {
    let at: Raw | undefined = raw;
    for (let hop = 0; at !== undefined && at.type === '' && hop <= MAX_CHAIN; hop++) at = isAlias(at.value) ? byPath.get(aliasPath(at.value)) : undefined;
    if (at !== undefined && at.type !== '') return [{ ...raw, type: at.type }];
    warn('DTCG_ALIAS_BROKEN', raw.path, `${raw.path}: an untyped reference that reaches no typed token is left out`);
    return [];
  });
}

/** The literal raw value a non-colour alias chain reaches, or why there is none. */
function followRaw(raws: ReadonlyMap<string, Raw>, start: Raw): Raw | string {
  let at = start;
  for (let hop = 0; isAlias(at.value); hop++) {
    const next = raws.get(aliasPath(at.value));
    if (next === undefined) return `${start.path}: its alias ${at.value} names no token`;
    if (next.type !== start.type) return `${start.path}: its alias ${at.value} is not a ${start.type} token`;
    if (hop >= MAX_CHAIN || next === start) return `${start.path}: its aliases return to it`;
    at = next;
  }
  return at;
}

/** One raw token as a theme token: decoded, a non-colour alias replaced by the value it reaches; undefined when dropped (warned). */
function decodeOne(raw: Raw, byPath: ReadonlyMap<string, Raw>, warn: Warn): Token | undefined {
  const site = { path: raw.path, warn };
  if (COMPOSITES.has(raw.type)) {
    warn('DTCG_UNSUPPORTED', raw.path, `${raw.path}: the ${raw.type} type is not supported; the token is left out`);
    return undefined;
  }
  const colorAlias = raw.type === 'color' && isAlias(raw.value);
  const source = colorAlias ? raw : followRaw(byPath, raw);
  if (typeof source === 'string') {
    warn('DTCG_ALIAS_BROKEN', raw.path, `${source}; the token is left out`);
    return undefined;
  }
  const value = colorAlias ? raw.value : literalOf(source, site);
  if (value === null) return undefined;
  const token = {
    $type: raw.type,
    ...(raw.description === undefined ? {} : { $description: raw.description }),
    $value: value,
    ...(raw.ext === undefined ? {} : { $extensions: raw.ext }),
  };
  if (value !== undefined && isValidToken(token)) return token;
  warn('DTCG_UNSUPPORTED', raw.path, `${raw.path}: not a ${raw.type} value the theme model takes; the token is left out`);
  return undefined;
}

/** The group `name` of `group`, made when absent. */
export function groupIn(group: Json, name: string): Json {
  if (!isObject(group[name])) group[name] = {};
  return group[name] as Json;
}

/** The nested tree of `raws` decoded (paths in tree order); what does not decode is left out, warned. */
export function decodedTree(raws: readonly Raw[], warn: Warn): Json {
  const byPath = new Map(raws.map((r) => [r.path, r]));
  const root: Json = {};
  for (const raw of raws) {
    const token = decodeOne(raw, byPath, warn);
    if (token === undefined) continue;
    const names = raw.path.split('.');
    names.slice(0, -1).reduce(groupIn, root)[names.at(-1) as string] = token;
  }
  return root;
}
