// Theme files (FR-THM-007, ADR-0055): a theme as DTCG 2025.10 JSON and back. `exportDtcg` writes the file, `importDtcg` reads a
// Fluxion theme file (one with the root `dev.fluxion` entry) to a deep-equal theme, and `themesFromFiles` turns a pack's theme
// files into its themes. Editor/CLI path only: the player never imports this module.

import { err, ok, type Result } from '@fluxion/schema';
import type { ThemeError } from './errors.js';
import { namedColorHex } from './named-colors.js';
import { oklchToCss, parseColor } from './oklch.js';
import { type ShadowValue, type Theme, TOKEN_REF, type Token, type TokenGroup } from './tokens.js';
import { validateTheme } from './validate-theme.js';

/**
 * A warning of a theme-file export or import: what was left out, and where.
 *
 * @public
 */
export type DtcgWarning = {
  /** `DTCG_UNSUPPORTED`: a value the format cannot carry (a `currentcolor` token, a colour form with no DTCG colour space). */
  readonly code: 'DTCG_UNSUPPORTED';
  /** The token path (`color.primary`). */
  readonly path: string;
  /** One-line message. */
  readonly message: string;
};

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
 * A theme read from a theme file, and what was left out.
 *
 * @public
 */
export type ImportedTheme = {
  /** The theme. */
  readonly theme: Theme;
  /** What could not be read (empty for a file `exportDtcg` wrote). */
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

const FLUXION = 'dev.fluxion';
const FILE_VERSION = 1;

type Json = { [key: string]: unknown };
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const round4 = (v: number): number => Math.round(v * 1e4) / 1e4;
const hex2 = (byte: number): string => byte.toString(16).padStart(2, '0');

/** A colour that import rebuilds exactly from its DTCG object. */
type Rgba = { readonly rgb: readonly [number, number, number]; readonly alpha: number };

/** The bytes of `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`, of a named colour or `transparent`, of `rgb()` or `hsl()`; else undefined. */
function rgbaOf(text: string): Rgba | undefined {
  const t = text.trim().toLowerCase();
  if (t === 'transparent') return { rgb: [0, 0, 0], alpha: 0 };
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(t)?.[1] ?? namedColorHex(t);
  if (hex !== undefined) {
    const full = hex.length <= 4 ? [...hex].map((d) => d + d).join('') : hex;
    const bytes = [0, 2, 4, 6].map((i) => (i < full.length ? Number.parseInt(full.slice(i, i + 2), 16) : 255));
    return { rgb: [bytes[0] as number, bytes[1] as number, bytes[2] as number], alpha: (bytes[3] as number) / 255 };
  }
  if (!/^(rgb|hsl)a?\(/.test(t)) return undefined;
  const color = parseColor(t);
  if (color === undefined) return undefined;
  // the sRGB bytes of the colour, opaque, then its own alpha
  const opaque = oklchToCss({ ...color, alpha: 1 });
  const bytes = [1, 3, 5].map((i) => Number.parseInt(opaque.slice(i, i + 2), 16));
  return { rgb: [bytes[0] as number, bytes[1] as number, bytes[2] as number], alpha: color.alpha };
}

/** The CSS text import writes for an sRGB colour: `#rrggbb`, with `aa` when it is not opaque. */
function srgbText(rgb: readonly number[], alpha: number): string {
  const aa = Math.round(alpha * 255);
  return `#${rgb.map(hex2).join('')}${aa === 255 ? '' : hex2(aa)}`;
}

/** The alpha and three components of a DTCG colour object, or undefined when they are malformed. */
function channelsOf(value: Json): { readonly alpha: number; readonly parts: readonly [number, number, number] } | undefined {
  const alpha = value['alpha'] === undefined ? 1 : value['alpha'];
  const parts = value['components'];
  if (typeof alpha !== 'number' || alpha < 0 || alpha > 1) return undefined;
  if (!Array.isArray(parts) || parts.length !== 3 || !parts.every((p) => typeof p === 'number' && Number.isFinite(p))) return undefined;
  return { alpha, parts: parts as [number, number, number] };
}

/** The sRGB bytes of a colour object: from its `hex` when that is `#rrggbb`, else from its components. */
function srgbBytes(value: Json, parts: readonly number[]): number[] {
  const hex = typeof value['hex'] === 'string' && /^#[0-9a-f]{6}$/i.test(value['hex']) ? value['hex'] : undefined;
  if (hex !== undefined) return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return parts.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255));
}

/** The CSS text of a DTCG colour object, or undefined when it is not one this reader knows. */
function colorText(value: unknown): string | undefined {
  const channels = isObject(value) ? channelsOf(value) : undefined;
  if (!isObject(value) || channels === undefined) return undefined;
  const { alpha, parts } = channels;
  if (value['colorSpace'] === 'srgb') return srgbText(srgbBytes(value, parts), alpha);
  const fn = value['colorSpace'] === 'oklch' || value['colorSpace'] === 'oklab' ? value['colorSpace'] : undefined;
  return fn === undefined ? undefined : `${fn}(${parts.join(' ')}${alpha === 1 ? '' : ` / ${alpha}`})`;
}

/** The DTCG colour object of a literal CSS colour, or undefined when the format has no colour space for its form. */
function colorObject(text: string): Json | undefined {
  const rgba = rgbaOf(text);
  if (rgba !== undefined) {
    return {
      colorSpace: 'srgb',
      components: rgba.rgb.map((v) => round4(v / 255)),
      alpha: round4(Math.round(rgba.alpha * 255) / 255),
      hex: `#${rgba.rgb.map(hex2).join('')}`,
    };
  }
  const fn = /^\s*(oklch|oklab)a?\(/i.exec(text)?.[1]?.toLowerCase();
  const color = fn === undefined ? undefined : parseColor(text);
  if (color === undefined) return undefined;
  const rad = (color.h * Math.PI) / 180;
  const components = fn === 'oklch' ? [color.l, color.c, color.h] : [color.l, color.c * Math.cos(rad), color.c * Math.sin(rad)];
  return { colorSpace: fn, components: components.map(round4), alpha: round4(color.alpha) };
}

/** `ext` with `dev.fluxion.css` set to `css` when the colour object does not rebuild `text` exactly. */
function withCss(ext: Token['$extensions'], text: string, object: Json): Json | undefined {
  if (colorText(object) === text) return ext === undefined ? undefined : { ...ext };
  const own = isObject(ext?.[FLUXION]) ? (ext?.[FLUXION] as Json) : {};
  return { ...ext, [FLUXION]: { ...own, css: text } };
}

/** `ext` without `dev.fluxion.css` (and without what that leaves empty), and the css text it held. */
function withoutCss(ext: unknown): { readonly ext: Json | undefined; readonly css: string | undefined } {
  if (!isObject(ext) || !isObject(ext[FLUXION]) || !('css' in ext[FLUXION])) return { ext: isObject(ext) ? ext : undefined, css: undefined };
  const { css, ...own } = ext[FLUXION];
  const { [FLUXION]: _dropped, ...rest } = ext;
  const next = Object.keys(own).length > 0 ? { ...rest, [FLUXION]: own } : rest;
  return { ext: Object.keys(next).length > 0 ? next : undefined, css: typeof css === 'string' ? css : undefined };
}

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
/**
 * The theme a Fluxion theme file holds (FR-THM-007, ADR-0055): the root `$extensions["dev.fluxion"]` entry (version 1) gives the
 * name, defaults and table styles, the token tree is read back from its DTCG form, and the theme is validated. A file without
 * that entry, of another version, with a value this reader does not know, or whose theme is invalid is `DTCG_INVALID`.
 *
 * @example
 * ```ts
 * const read = importDtcg(JSON.parse(text));
 * if (read.ok) use(read.value.theme);
 * ```
 * @public
 */
export function importDtcg(json: unknown): Result<ImportedTheme, ThemeError> {
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
 * The themes of a theme pack from its theme files (FR-THM-007): each file read by `importDtcg`, its id `<packId>:<slug of name>`,
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
    const read = importDtcg(file);
    if (!read.ok) return invalid(`theme file ${index}: ${read.error.message}`);
    const id = `${packId}:${slugOf(read.value.theme.name)}`;
    if (out.some((theme) => theme.id === id)) return invalid(`theme file ${index}: another file already gives the theme ${id}`);
    out.push({ ...read.value.theme, id });
  }
  return ok(out);
}
