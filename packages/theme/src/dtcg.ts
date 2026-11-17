// Theme files (FR-THM-007, ADR-0055): a theme as DTCG 2025.10 JSON and back. `exportDtcg` writes the file, `importDtcg` reads a
// Fluxion theme file (one with the root `dev.fluxion` entry) to a deep-equal theme, and `themesFromFiles` turns a pack's theme
// files into its themes. Editor/CLI path only: the player never imports this module.

import { err, ok, type Result } from '@fluxion/schema';
import { colorObject, colorText, FLUXION, isObject, type Json, withCss, withoutCss } from './dtcg-codec.js';
import { importForeign } from './dtcg-foreign.js';
import type { DtcgWarning, ImportedTheme } from './dtcg-types.js';
import type { ThemeError } from './errors.js';
import { LIGHT_THEME } from './light.js';
import { type ShadowValue, type Theme, TOKEN_REF, type Token, type TokenGroup } from './tokens.js';
import { validateTheme } from './validate-theme.js';

/**
 * A theme file: DTCG JSON with the theme's name, defaults and table styles under the root `$extensions["dev.fluxion"]`.
 *
 * @public
 */
export type ThemeFile = { readonly [key: string]: unknown };

/**
 * A theme file `exportDtcg` wrote, and what it left out.
 *
 * @public
 */
export type ExportedTheme = {
  /** The theme file (serialise it with `JSON.stringify`). */
  readonly file: ThemeFile;
  /** The tokens left out (empty unless the theme has a `currentcolor` or another colour with no DTCG colour space). */
  readonly warnings: readonly DtcgWarning[];
};

/**
 * A theme of a pack made from theme files: the theme and its registry id `<pack id>:<slug of name>` (a pack's `ThemeDef`).
 *
 * @public
 */
export type FileTheme = Theme & {
  /** `<pack id>:<slug of name>`. */
  readonly id: string;
};

const FILE_VERSION = 1;

const px = (value: number): Json => ({ value, unit: 'px' });

/** A token's `$value` as DTCG and its `$extensions`, or why it cannot be written. */
function exportValue(token: Token): { readonly $value: unknown; readonly ext: Json | undefined } | string {
  const ext = token.$extensions === undefined ? undefined : { ...token.$extensions };
  if (token.$type === 'color') {
    if (TOKEN_REF.test(token.$value)) return { $value: token.$value, ext };
    const object = colorObject(token.$value);
    return object === undefined
      ? `the colour ${token.$value} has no DTCG colour space`
      : { $value: object, ext: withCss(token.$extensions, token.$value, object) };
  }
  if (token.$type === 'shadow') {
    const { color, offsetX, offsetY, blur, spread } = token.$value;
    const object = colorObject(color);
    if (object === undefined) return `the shadow colour ${color} has no DTCG colour space`;
    return {
      $value: { color: object, offsetX: px(offsetX), offsetY: px(offsetY), blur: px(blur), spread: px(spread) },
      ext: withCss(token.$extensions, color, object),
    };
  }
  return { $value: token.$value, ext };
}

/** One token as DTCG, or why it cannot be written. */
function exportToken(token: Token): Json | string {
  const written = exportValue(token);
  if (typeof written === 'string') return written;
  return {
    $type: token.$type,
    ...(token.$description === undefined ? {} : { $description: token.$description }),
    $value: written.$value,
    ...(written.ext === undefined ? {} : { $extensions: written.ext }),
  };
}

function exportGroup(group: TokenGroup, prefix: string, warnings: DtcgWarning[]): Json {
  const out: Json = {};
  for (const [name, node] of Object.entries(group)) {
    const path = prefix === '' ? name : `${prefix}.${name}`;
    if (!isObject(node) || !('$value' in node)) {
      out[name] = exportGroup(node as TokenGroup, path, warnings);
      continue;
    }
    const written = exportToken(node as Token);
    if (typeof written === 'string') warnings.push({ code: 'DTCG_UNSUPPORTED', path, message: `${path}: ${written}; the token is left out` });
    else out[name] = written;
  }
  return out;
}

/**
 * `theme` as a theme file (FR-THM-007, ADR-0055): its token tree in DTCG 2025.10 form (colours as colour objects, with the original
 * CSS text in `dev.fluxion.css` when the object does not rebuild it; shadow lengths as px dimensions) and its name, defaults and
 * table styles under the root `$extensions["dev.fluxion"]`. A token the format cannot carry (`currentcolor`) is left out with a
 * warning; otherwise `importDtcg` of the file is deep-equal to `theme`.
 *
 * @example
 * ```ts
 * const { file } = exportDtcg(LIGHT_THEME);
 * const text = JSON.stringify(file, null, 2); // light.tokens.json
 * ```
 * @public
 */
export function exportDtcg(theme: Theme): ExportedTheme {
  const warnings: DtcgWarning[] = [];
  const entry: Json = { version: FILE_VERSION, name: theme.name };
  if (theme.defaults !== undefined) entry['defaults'] = theme.defaults;
  if (theme.tableStyles !== undefined) entry['tableStyles'] = theme.tableStyles;
  const tokens = exportGroup(theme.tokens, '', warnings);
  return { file: { $extensions: { [FLUXION]: entry }, ...tokens }, warnings };
}

const invalid = (message: string): Result<never, ThemeError> => err({ code: 'DTCG_INVALID', message });
const lengthOf = (v: unknown): number | undefined => (isObject(v) && v['unit'] === 'px' && typeof v['value'] === 'number' ? v['value'] : undefined);

/** A DTCG shadow value as a theme shadow (its colour `css` when the token kept the text), or undefined when it is not one. */
function importShadow(v: unknown, css: string | undefined): ShadowValue | undefined {
  if (!isObject(v)) return undefined;
  const color = css ?? colorText(v['color']);
  const [offsetX, offsetY, blur, spread] = [v['offsetX'], v['offsetY'], v['blur'], v['spread']].map(lengthOf);
  if (color === undefined || offsetX === undefined || offsetY === undefined || blur === undefined || spread === undefined) return undefined;
  return { color, offsetX, offsetY, blur, spread };
}

/** A DTCG token's `$value` as a theme token's (`css`: the colour text the token kept), or undefined when this reader does not know it. */
function importValue(node: Json, css: string | undefined): unknown {
  if (node['$type'] === 'color')
    return typeof node['$value'] === 'string' && TOKEN_REF.test(node['$value']) ? node['$value'] : (css ?? colorText(node['$value']));
  if (node['$type'] === 'shadow') return importShadow(node['$value'], css);
  return node['$value'];
}

/** One DTCG token as a theme token, or why it cannot be read. */
function importToken(node: Json): Token | string {
  const { ext, css } = withoutCss(node['$extensions']);
  const $value = importValue(node, css);
  if ($value === undefined) return `not a ${String(node['$type'])} value this reader knows`;
  return {
    $type: node['$type'],
    ...(node['$description'] === undefined ? {} : { $description: node['$description'] }),
    $value,
    ...(ext === undefined ? {} : { $extensions: ext }),
  } as Token;
}

function importGroup(group: Json, prefix: string): Result<TokenGroup, ThemeError> {
  const out: { [name: string]: Token | TokenGroup } = {};
  for (const [name, node] of Object.entries(group)) {
    const path = prefix === '' ? name : `${prefix}.${name}`;
    if (!isObject(node)) return invalid(`${path} is neither a token nor a group`);
    if ('$value' in node) {
      const token = importToken(node);
      if (typeof token === 'string') return invalid(`${path}: ${token}`);
      out[name] = token;
      continue;
    }
    const inner = importGroup(node, path);
    if (!inner.ok) return inner;
    out[name] = inner.value;
  }
  return ok(out);
}

/** The root `dev.fluxion` entry of a Fluxion theme file (version 1, with a name) and its token tree without root `$` keys. */
function fluxionEntry(json: unknown): Result<{ readonly entry: Json & { readonly name: string }; readonly tree: Json }, ThemeError> {
  if (!isObject(json)) return invalid('a theme file is a JSON object');
  const rootExt = json['$extensions'];
  const entry = isObject(rootExt) ? rootExt[FLUXION] : undefined;
  if (!isObject(entry)) return invalid('the file has no $extensions["dev.fluxion"] theme entry');
  if (entry['version'] !== FILE_VERSION) return invalid(`theme file version ${String(entry['version'])} is not supported (expected ${FILE_VERSION})`);
  if (typeof entry['name'] !== 'string') return invalid('the theme entry has no name');
  const tree = Object.fromEntries(Object.entries(json).filter(([key]) => !key.startsWith('$')));
  return ok({ entry: entry as Json & { readonly name: string }, tree });
}
/** The theme of a Fluxion theme file, read as is (FR-THM-007): `DTCG_INVALID` for a file that is not one or does not read. */
function importFluxion(json: unknown): Result<ImportedTheme, ThemeError> {
  const read = fluxionEntry(json);
  if (!read.ok) return read;
  const { entry, tree } = read.value;
  const tokens = importGroup(tree, '');
  if (!tokens.ok) return tokens;
  const theme = {
    name: entry.name,
    tokens: tokens.value,
    ...(entry['defaults'] === undefined ? {} : { defaults: entry['defaults'] }),
    ...(entry['tableStyles'] === undefined ? {} : { tableStyles: entry['tableStyles'] }),
  } as Theme;
  const problem = validateTheme(theme)[0];
  if (problem !== undefined) return invalid(`the theme is invalid at ${problem.path || '/'}: ${problem.message}`);
  return ok({ theme, warnings: [] });
}

/**
 * How {@link importDtcg} reads a file that is not a Fluxion theme file.
 *
 * @public
 */
export type DtcgImportOptions = {
  /** The imported theme's name (default: the stem of `fileName`, else `imported`). */
  readonly name?: string;
  /** The file's name, whose stem names the theme when `name` is absent. */
  readonly fileName?: string;
  /** The theme a foreign file is merged onto (default: the light theme). */
  readonly base?: Theme;
};

/**
 * The theme a DTCG file holds (FR-THM-007, FR-THM-009, ADR-0055). A Fluxion theme file (with the root `$extensions["dev.fluxion"]`
 * entry, version 1) is read as is: `exportDtcg`'s output reads back deep-equal, and one that does not read is `DTCG_INVALID`. Any
 * other file (Tokens Studio, Style Dictionary, Figma) is merged onto `options.base` in ADR-0055's six steps: group `$type` resolved
 * onto tokens, `rem` and `s` converted, colliding paths renamed, mistyped and broken tokens dropped, and each required colour role
 * aliased to the file's own name for it (`bg`, `brand`, a ramp's step 500…) or kept from the base; each such change is a warning, and
 * the import does not fail. Only input that is not a JSON object, or an internal error, is `DTCG_INVALID` there.
 *
 * @example
 * ```ts
 * const read = importDtcg(JSON.parse(text), { fileName: 'brand.tokens.json' });
 * if (read.ok) use(read.value.theme, read.value.warnings);
 * ```
 * @public
 */
export function importDtcg(json: unknown, options: DtcgImportOptions = {}): Result<ImportedTheme, ThemeError> {
  if (!isObject(json)) return invalid('a theme file is a JSON object');
  const ext = json['$extensions'];
  if (isObject(ext) && FLUXION in ext) return importFluxion(json);
  return importForeign(json, { ...options, base: options.base ?? LIGHT_THEME });
}

/** The slug of a theme name: lower case, each run of other characters than a–z and 0–9 one `-`, no `-` at either end. */
const slugOf = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'theme';

/**
 * The file name of `theme`'s theme file: `<slug of name>.tokens.json`.
 *
 * @public
 */
export const themeFileName = (theme: Pick<Theme, 'name'>): string => `${slugOf(theme.name)}.tokens.json`;

/**
 * The themes of a theme pack from its theme files (FR-THM-007): each a Fluxion theme file read as `importDtcg` reads one, its id `<packId>:<slug of name>`,
 * ready for a pack's `themes`. All or nothing: a file that does not read, or two themes with one id, is `DTCG_INVALID` naming the
 * file's index.
 *
 * @example
 * ```ts
 * const themes = themesFromFiles('acme', [oceanFile, forestFile]);
 * if (themes.ok) definePack({ id: 'acme', themes: themes.value });
 * ```
 * @public
 */
export function themesFromFiles(packId: string, files: readonly unknown[]): Result<readonly FileTheme[], ThemeError> {
  const out: FileTheme[] = [];
  for (const [index, file] of files.entries()) {
    const read = importFluxion(file);
    if (!read.ok) return invalid(`theme file ${index}: ${read.error.message}`);
    const id = `${packId}:${slugOf(read.value.theme.name)}`;
    if (out.some((theme) => theme.id === id)) return invalid(`theme file ${index}: another file already gives the theme ${id}`);
    out.push({ ...read.value.theme, id });
  }
  return ok(out);
}
