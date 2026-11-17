// Foreign DTCG files (FR-THM-009, ADR-0055 "Foreign files"): a Tokens Studio, Style Dictionary or Figma token file merged onto a
// base theme in six steps that drop or rename, never fail (shape, type, overlay, references, roles, finish). Package-internal:
// `importDtcg` calls it for a file without the root `dev.fluxion` entry. Editor/CLI path only.

import { err, ok, type Result } from '@fluxion/schema';
import { colorResolver, needsResolving } from './alias.js';
import { isObject, type Json } from './dtcg-codec.js';
import { aliasPath, collect, decodedTree, groupIn, isAlias, joinPath, typeReferences, type Warn } from './dtcg-read.js';
import type { DtcgWarning, ImportedTheme } from './dtcg-types.js';
import type { ThemeError } from './errors.js';
import { cssVarName, isToken, nodeAt, type Theme, TOKEN_REF, type Token, type TokenGroup, tokenEntries } from './tokens.js';
import { expectedType, REQUIRED_COLOR_ROLES, validateTheme } from './validate-theme.js';

/** What a foreign import merges onto, and what it calls the theme. */
export type ForeignOptions = { readonly name?: string; readonly fileName?: string; readonly base: Theme };

/** The candidates of a required role with no colour of its own, under `color.` (after the role's own moved ramp). */
const ROLE_NAMES: { readonly [role: string]: readonly string[] } = {
  background: ['bg', 'background.default', 'canvas'],
  surface: ['surface.default', 'background.subtle'],
  text: ['foreground', 'fg', 'text.default', 'text.primary'],
  muted: ['text.muted', 'text.secondary', 'fg.muted'],
  primary: ['brand', 'brand.primary', 'primary.default', 'accent'],
  secondary: ['brand.secondary', 'secondary.default'],
  danger: ['error', 'critical'],
  success: ['positive'],
  warning: ['caution'],
  info: ['informative'],
};

const isTokenNode = (v: unknown): boolean => isObject(v) && '$value' in v;

/** `name` made unique against `used` with `-2`, `-3`… (and taken). */
function unique(name: string, used: Set<string>): string {
  let out = name;
  for (let n = 2; used.has(out); n++) out = `${name}-${n}`;
  used.add(out);
  return out;
}

/** Where `reshape` is: the group's path in the file and in the result. */
type Place = { readonly from: readonly string[]; readonly to: readonly string[] };

/** The base node a foreign node is reshaped against: a base group it may enter, else none. */
const baseGroup = (there: Token | TokenGroup | undefined): TokenGroup | undefined => (there === undefined || isToken(there) ? undefined : there);

/** The name a foreign child takes beside the base's: its own, or `-value`/`-ramp` added when its kind (token, group) clashes there. */
function childName(name: string, leaf: boolean, there: Token | TokenGroup | undefined, used: Set<string>): string {
  if (there === undefined || isToken(there) === leaf) return name;
  return unique(`${name}${leaf ? '-value' : '-ramp'}`, used);
}

/** Step 1: the foreign tree reshaped so `base` paths keep their shape; each move is a `[from, to]` path pair added to `moves`. */
function reshape(group: Json, base: TokenGroup | undefined, place: Place, moves: Array<readonly [string, string]>): Json {
  const used = new Set([...Object.keys(base ?? {}), ...Object.keys(group)]);
  const out: Json = {};
  for (const [name, node] of Object.entries(group)) {
    const there = base?.[name];
    const leaf = isTokenNode(node);
    const moved = childName(name, leaf, there, used);
    if (moved !== name) moves.push([joinPath([...place.from, name]), joinPath([...place.to, moved])]);
    const inner = { from: [...place.from, name], to: [...place.to, moved] };
    out[moved] = leaf ? node : reshape(node as Json, moved === name ? baseGroup(there) : undefined, inner, moves);
  }
  return out;
}

/** `path` after the moves (the longest moved prefix wins). */
function movedPath(path: string, moves: ReadonlyArray<readonly [string, string]>): string {
  const hit = moves.filter(([from]) => path === from || path.startsWith(`${from}.`)).sort((a, b) => b[0].length - a[0].length)[0];
  return hit === undefined ? path : hit[1] + path.slice(hit[0].length);
}

/** `token` with its alias and its `mix.with` links rewritten after the moves. */
function relink(token: Token, moves: ReadonlyArray<readonly [string, string]>): Token {
  if (token.$type !== 'color' || moves.length === 0) return token;
  const link = (ref: unknown) => (isAlias(ref) ? `{${movedPath(aliasPath(ref), moves)}}` : ref);
  const own = token.$extensions?.['dev.fluxion'];
  const steps = isObject(own) && Array.isArray(own['transform']) ? own['transform'] : undefined;
  const transform = steps?.map((step) => (isObject(step) && isObject(step['mix']) ? { mix: { ...step['mix'], with: link(step['mix']['with']) } } : step));
  return {
    ...token,
    $value: link(token.$value) as string,
    ...(transform === undefined ? {} : { $extensions: { ...token.$extensions, 'dev.fluxion': { ...(own as Json), transform } } }),
  };
}

/** A deep copy of a JSON tree. */
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Set (or, with `token` undefined, remove) the token at `path`, making groups on the way. */
function setAt(tokens: TokenGroup, path: string, token: Token | undefined): void {
  const names = path.split('.');
  const group = names.slice(0, -1).reduce(groupIn, tokens as Json);
  const last = names.at(-1) as string;
  if (token === undefined) delete group[last];
  else group[last] = token;
}

/** Of two paths with one CSS variable, the later in tree order is removed (warned). */
function dropCollisions(tokens: TokenGroup, paths: Set<string>, warn: Warn): void {
  const names = new Map<string, string>();
  for (const [path] of tokenEntries(tokens)) {
    const earlier = names.get(cssVarName(path));
    if (earlier === undefined) {
      names.set(cssVarName(path), path);
      continue;
    }
    warn('DTCG_UNSUPPORTED', path, `${path}: the CSS variable ${cssVarName(path)} is already ${earlier}'s; the token is left out`);
    setAt(tokens, path, undefined);
    paths.delete(path);
  }
}

/** Steps 2 and 3: the foreign tokens that keep their type, laid over a copy of `base`'s tree; returns the tree and the foreign paths. */
function overlay(base: Theme, foreign: ReadonlyArray<readonly [string, Token]>, warn: Warn): { tokens: TokenGroup; paths: Set<string> } {
  const tokens = copy(base.tokens);
  const paths = new Set<string>();
  for (const [path, token] of foreign) {
    const there = nodeAt(base.tokens, path);
    const want = there !== undefined && isToken(there) ? there.$type : expectedType(path);
    if (want !== undefined && want !== token.$type) {
      warn('DTCG_TYPE_MISMATCH', path, `${path}: a ${token.$type} token where the theme has ${want}; the token is left out`);
      continue;
    }
    setAt(tokens, path, token);
    paths.add(path);
  }
  dropCollisions(tokens, paths, warn);
  return { tokens, paths };
}

/** The first foreign colour whose links break or loop, and why; undefined when none does. */
function firstBroken(name: string, tokens: TokenGroup, paths: ReadonlySet<string>): readonly [string, string] | undefined {
  const follow = colorResolver({ name, tokens });
  for (const [path, token] of tokenEntries(tokens)) {
    if (!paths.has(path) || !needsResolving(token)) continue;
    const r = follow(path);
    if (!r.ok) return [path, r.error.message];
  }
  return undefined;
}

/** Step 4: a foreign colour whose links break or loop is dropped (the base token, if any, restored), until none is. */
function dropBroken(base: Theme, tokens: TokenGroup, paths: Set<string>, warn: Warn): void {
  for (let broken = firstBroken(base.name, tokens, paths); broken !== undefined; broken = firstBroken(base.name, tokens, paths)) {
    const [path, why] = broken;
    warn('DTCG_ALIAS_BROKEN', path, `${path}: ${why}; the token is left out`);
    const own = nodeAt(base.tokens, path);
    setAt(tokens, path, own !== undefined && isToken(own) ? own : undefined);
    paths.delete(path);
  }
}

/** The step a ramp (a group of colour tokens) stands for: `500`, else the median of numeric steps (the lower), else the middle one. */
function rampStep(group: TokenGroup): string | undefined {
  const steps = Object.entries(group);
  if (steps.length === 0 || !steps.every(([, t]) => isToken(t) && t.$type === 'color')) return undefined;
  const names = steps.map(([n]) => n);
  if (names.includes('500')) return '500';
  const ordered = names.every((n) => /^\d+$/.test(n)) ? [...names].sort((a, b) => Number(a) - Number(b)) : names;
  return ordered[(ordered.length - 1) >> 1];
}

/** The colour path a role candidate gives: the path of a colour token, a ramp's step, or none. */
function candidateColor(tokens: TokenGroup, path: string): string | undefined {
  const node = nodeAt(tokens, path);
  if (node === undefined) return undefined;
  if (isToken(node)) return node.$type === 'color' ? path : undefined;
  const step = rampStep(node);
  return step === undefined ? undefined : `${path}.${step}`;
}

/** Whether `color.<role>` aliasing `chosen` resolves (the candidate's chain does not lead back to the role); the alias is kept if so. */
function aliasRole(tokens: TokenGroup, at: string, chosen: string): boolean {
  const before = nodeAt(tokens, at);
  setAt(tokens, at, { $type: 'color', $value: `{${chosen}}` });
  if (colorResolver({ name: 'imported', tokens })(at).ok) return true;
  setAt(tokens, at, before !== undefined && isToken(before) ? before : undefined);
  return false;
}

/** Step 5: each required role the file does not colour aliases its first candidate that resolves, or keeps `base`'s value. */
function mapRoles(tokens: TokenGroup, paths: ReadonlySet<string>, moves: ReadonlyArray<readonly [string, string]>, warn: Warn): void {
  for (const role of REQUIRED_COLOR_ROLES) {
    const at = `color.${role}`;
    if (paths.has(at)) continue;
    const candidates = [`color.${role}-ramp`, ...(ROLE_NAMES[role] ?? []).map((n) => movedPath(`color.${n}`, moves))];
    // a candidate whose links return to the role (`bg: {color.background}`) is passed over, never a loop
    const chosen = candidates.map((c) => candidateColor(tokens, c)).find((c) => c !== undefined && aliasRole(tokens, at, c));
    if (chosen === undefined) warn('DTCG_ROLE_DEFAULTED', at, `${at}: the file gives no colour for it; the base theme's is kept`);
    else warn('DTCG_ROLE_MAPPED', at, `${at}: taken from ${chosen}`);
  }
}

/** The name of an imported theme: `name`, else the stem of `fileName`, else `imported`. */
function nameOf(options: ForeignOptions): string {
  if (options.name !== undefined && options.name.trim() !== '') return options.name;
  const stem = options.fileName
    ?.split(/[\\/]/)
    .at(-1)
    ?.replace(/(\.tokens)?\.json$/i, '');
  return stem !== undefined && stem !== '' ? stem : 'imported';
}

/**
 * A foreign DTCG file merged onto `options.base` (ADR-0055 steps 1–6), with what was renamed, dropped or mapped as warnings. Fails
 * (`DTCG_INVALID`) only when the merged theme is still invalid, which steps 1–5 leave to an internal error.
 */
export function importForeign(json: Json, options: ForeignOptions): Result<ImportedTheme, ThemeError> {
  const warnings: DtcgWarning[] = [];
  const warn: Warn = (code, path, message) => warnings.push({ code, path, message });
  const raws = typeReferences(collect(json, { path: [], type: undefined }, warn), warn);
  const moves: Array<readonly [string, string]> = [];
  const shaped = reshape(decodedTree(raws, warn), options.base.tokens, { from: [], to: [] }, moves);
  for (const [from, to] of moves) warn('DTCG_PATH_RENAMED', from, `${from}: moved to ${to}, where the theme's own path keeps its shape`);
  const foreign = tokenEntries(shaped as TokenGroup).map(([path, token]) => [path, relink(token, moves)] as const);
  const { tokens, paths } = overlay(options.base, foreign, warn);
  dropBroken(options.base, tokens, paths, warn);
  mapRoles(tokens, paths, moves, warn);
  const theme: Theme = {
    name: nameOf(options),
    tokens,
    ...(options.base.defaults === undefined ? {} : { defaults: options.base.defaults }),
    ...(options.base.tableStyles === undefined ? {} : { tableStyles: options.base.tableStyles }),
  };
  const problem = validateTheme(theme)[0];
  if (problem !== undefined) return err({ code: 'DTCG_INVALID', message: `the imported theme is invalid at ${problem.path || '/'}: ${problem.message}` });
  return ok({ theme, warnings });
}
